import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  Headers,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TrackingService } from './tracking.service.js';
import { HeatmapService } from './heatmap.service.js';
import { BatchLocationUpdateDto, LocationUpdateDto } from './dto/location-update.dto.js';
import { HeatmapQueryDto, ZoneTrafficQueryDto, HistoricalQueryDto } from './dto/heatmap-query.dto.js';
import { SupabaseService } from '../supabase/supabase.service.js';

@ApiTags('tracking')
@Controller('tracking')
export class TrackingController {
  private readonly logger = new Logger(TrackingController.name);

  constructor(
    private readonly tracking: TrackingService,
    private readonly heatmap: HeatmapService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Extract and verify visitor ID from bearer token
   */
  private async getVisitorId(authorization?: string): Promise<string> {
    if (!authorization) {
      throw new UnauthorizedException('Authorization header required');
    }

    const token = authorization.replace('Bearer ', '');
    const {
      data: { user },
      error,
    } = await this.supabase.getAdminClient().auth.getUser(token);

    if (error || !user) {
      throw new UnauthorizedException('Invalid token');
    }

    return user.id;
  }

  // =====================================================
  // Location Tracking (Mobile REST fallback)
  // =====================================================

  @Post('location')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit a single location update (REST fallback)',
    description: 'Use WebSocket for real-time; this endpoint is for offline sync or fallback',
  })
  @ApiResponse({ status: 202, description: 'Location accepted' })
  async submitLocation(
    @Headers('authorization') auth: string,
    @Body() dto: LocationUpdateDto,
  ) {
    const visitorId = await this.getVisitorId(auth);
    const result = await this.tracking.processLocationUpdate(visitorId, dto);

    return {
      status: 'accepted',
      zones: result.zones.map((z) => z.zone_name),
      timestamp: new Date().toISOString(),
    };
  }

  @Post('location/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit batch location updates (offline sync)' })
  @ApiResponse({ status: 202, description: 'Batch accepted' })
  async submitBatchLocations(
    @Headers('authorization') auth: string,
    @Body() dto: BatchLocationUpdateDto,
  ) {
    const visitorId = await this.getVisitorId(auth);
    const result = await this.tracking.processBatchUpdate(visitorId, dto.locations);

    return {
      status: 'accepted',
      processed: result.processed,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // Heatmap Data (Admin endpoints)
  // =====================================================

  @Get('heatmap/live')
  @ApiOperation({ summary: 'Get live heatmap data from active users' })
  @ApiResponse({ status: 200, description: 'Array of heatmap points' })
  getLiveHeatmap() {
    const points = this.heatmap.getLiveHeatmapData();
    return {
      points,
      activeUsers: this.tracking.getActiveUserCount(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('heatmap')
  @ApiOperation({ summary: 'Get heatmap data for a viewport and time range' })
  @ApiResponse({ status: 200, description: 'Array of heatmap points with intensity' })
  async getHeatmap(@Query() query: HeatmapQueryDto) {
    const points = await this.heatmap.getHistoricalHeatmapData(
      query.minLat,
      query.minLng,
      query.maxLat,
      query.maxLng,
      query.since,
      query.until,
    );

    return {
      points,
      count: points.length,
      viewport: {
        minLat: query.minLat,
        minLng: query.minLng,
        maxLat: query.maxLat,
        maxLng: query.maxLng,
      },
      timeRange: {
        since: query.since || 'last 5 minutes',
        until: query.until || 'now',
      },
    };
  }

  // =====================================================
  // Zone Analytics
  // =====================================================

  @Get('zones/traffic')
  @ApiOperation({ summary: 'Get traffic summary per zone' })
  async getZoneTraffic(@Query() query: ZoneTrafficQueryDto) {
    const traffic = await this.heatmap.getZoneTraffic(query.since, query.zoneType);
    return { zones: traffic, timestamp: new Date().toISOString() };
  }

  @Get('zones/occupancy/live')
  @ApiOperation({ summary: 'Get live zone occupancy from active users' })
  getLiveZoneOccupancy() {
    const occupancy = this.heatmap.getLiveZoneOccupancy();
    const stats = this.heatmap.getVenueStats();
    return {
      ...stats,
      zones: occupancy,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('zones/occupancy/timeline')
  @ApiOperation({ summary: 'Get zone occupancy over time (for charts)' })
  async getZoneTimeline(@Query() query: HistoricalQueryDto) {
    const timeline = await this.heatmap.getZoneOccupancyTimeline(
      query.startDate,
      query.endDate,
      query.zoneId,
      query.intervalMinutes,
    );

    return { timeline, timestamp: new Date().toISOString() };
  }

  @Get('zones/popular')
  @ApiOperation({ summary: 'Get most popular zones ranked by visitors' })
  async getPopularZones(@Query('since') since?: string, @Query('limit') limit?: number) {
    const zones = await this.heatmap.getPopularZones(since, limit || 10);
    return { zones, timestamp: new Date().toISOString() };
  }

  @Get('zones/peak-times')
  @ApiOperation({ summary: 'Get peak traffic times per zone' })
  async getPeakTimes(@Query('zoneId') zoneId?: string, @Query('days') days?: number) {
    const peaks = await this.heatmap.getPeakTimes(zoneId, days || 7);
    return { peaks, timestamp: new Date().toISOString() };
  }

  // =====================================================
  // Venue Stats
  // =====================================================

  @Get('stats')
  @ApiOperation({ summary: 'Get real-time venue statistics' })
  getVenueStats() {
    const stats = this.heatmap.getVenueStats();
    return {
      ...stats,
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // Venue Zones Management
  // =====================================================

  @Get('zones')
  @ApiOperation({ summary: 'List all venue zones' })
  async listZones() {
    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('venue_zones')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      this.logger.error(`Failed to fetch zones: ${error.message}`);
      return { zones: [] };
    }

    return { zones: data };
  }

  // =====================================================
  // Dummy Data Generation (Development / Testing)
  // =====================================================

  @Post('simulate')
  @ApiOperation({
    summary: 'Generate randomized dummy tracking data for testing',
    description:
      'Spawns simulated visitors around the ZITF venue centre using real visitor IDs from the database. ' +
      'Each call populates the in-memory state so the heatmap lights up immediately.',
  })
  @ApiResponse({ status: 200, description: 'Simulated visitors injected' })
  async simulateTrackingData(
    @Body()
    body: {
      count?: number;
      spreadMeters?: number;
      clusterAround?: { lat: number; lng: number }[];
    },
  ) {
    const count = Math.min(body?.count || 80, 500);
    const spreadMeters = body?.spreadMeters || 250;

    // ZITF Exhibition Centre, Bulawayo
    const ZITF_CENTER = { lat: -20.1575, lng: 28.5833 };

    // Optional cluster points (halls, entrances, food courts, etc.)
    const clusters = body?.clusterAround?.length
      ? body.clusterAround
      : [
          { lat: -20.1575, lng: 28.5833 }, // Center
          { lat: -20.1568, lng: 28.5825 }, // NW cluster
          { lat: -20.1582, lng: 28.5840 }, // SE cluster
          { lat: -20.1570, lng: 28.5845 }, // NE cluster
          { lat: -20.1585, lng: 28.5828 }, // SW cluster
          { lat: -20.1573, lng: 28.5835 }, // Near centre
        ];

    // Fetch real visitor IDs to make the simulation realistic
    const db = this.supabase.getAdminClient();
    const { data: visitors } = await db
      .from('visitors')
      .select('id')
      .limit(count);

    const visitorIds: string[] = (visitors || []).map((v: any) => v.id);

    // If not enough real visitors, generate fake UUIDs
    while (visitorIds.length < count) {
      visitorIds.push(
        `sim-${Math.random().toString(36).substring(2, 10)}-${Date.now()}`,
      );
    }

    const now = new Date();
    let injected = 0;

    for (let i = 0; i < count; i++) {
      // Pick a random cluster to simulate crowd gathering
      const cluster = clusters[Math.floor(Math.random() * clusters.length)];

      // Random offset in meters, converted to degrees
      // ~111,320 meters per degree latitude, ~111,320 * cos(lat) per degree longitude
      const metersPerDegreeLat = 111320;
      const metersPerDegreeLng =
        111320 * Math.cos((cluster.lat * Math.PI) / 180);

      // Gaussian-ish distribution (sum of uniforms) for more realistic clustering
      const randGauss = () =>
        (Math.random() + Math.random() + Math.random()) / 3 - 0.5;
      const offsetLat = (randGauss() * spreadMeters) / metersPerDegreeLat;
      const offsetLng = (randGauss() * spreadMeters) / metersPerDegreeLng;

      const lat = cluster.lat + offsetLat;
      const lng = cluster.lng + offsetLng;

      // Randomise accuracy, speed, heading
      const accuracy = 3 + Math.random() * 20;
      const speed = Math.random() < 0.3 ? 0 : Math.random() * 2;
      const heading = Math.random() * 360;

      const recordedAt = new Date(
        now.getTime() - Math.floor(Math.random() * 60000),
      ).toISOString();

      try {
        await this.tracking.processLocationUpdate(visitorIds[i], {
          latitude: lat,
          longitude: lng,
          accuracy,
          speed,
          heading,
          recordedAt,
          idempotencyKey: `sim-${i}-${Date.now()}`,
          networkType: Math.random() > 0.5 ? 'wifi' : '4g',
        } as any);
        injected++;
      } catch (err) {
        this.logger.warn(`Simulate injection failed for ${i}: ${err}`);
      }
    }

    return {
      injected,
      requested: count,
      clusters: clusters.length,
      activeUsers: this.tracking.getActiveUserCount(),
      timestamp: new Date().toISOString(),
    };
  }

  @Post('simulate/continuous')
  @ApiOperation({
    summary: 'Start continuous simulation that moves dummy visitors around',
    description:
      'Spawns visitors and then moves them slightly every 2 seconds for the given duration. ' +
      'Useful for testing the live heatmap animation.',
  })
  async simulateContinuous(
    @Body()
    body: {
      count?: number;
      durationSeconds?: number;
      intervalMs?: number;
    },
  ) {
    const count = Math.min(body?.count || 40, 200);
    const duration = Math.min(body?.durationSeconds || 60, 300); // max 5 min
    const interval = Math.max(body?.intervalMs || 2000, 500);

    const ZITF_CENTER = { lat: -20.1575, lng: 28.5833 };
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng =
      111320 * Math.cos((ZITF_CENTER.lat * Math.PI) / 180);

    // Initialize positions
    const agents: Array<{
      id: string;
      lat: number;
      lng: number;
      speedLat: number;
      speedLng: number;
    }> = [];

    for (let i = 0; i < count; i++) {
      agents.push({
        id: `walk-${i}-${Date.now()}`,
        lat: ZITF_CENTER.lat + ((Math.random() - 0.5) * 200) / metersPerDegreeLat,
        lng: ZITF_CENTER.lng + ((Math.random() - 0.5) * 200) / metersPerDegreeLng,
        speedLat: ((Math.random() - 0.5) * 2) / metersPerDegreeLat, // ~1 m/s
        speedLng: ((Math.random() - 0.5) * 2) / metersPerDegreeLng,
      });
    }

    const ticks = Math.floor((duration * 1000) / interval);
    let ticksDone = 0;

    const timer = setInterval(async () => {
      ticksDone++;
      if (ticksDone >= ticks) {
        clearInterval(timer);
        this.logger.log(`Continuous simulation ended after ${duration}s`);
        return;
      }

      for (const agent of agents) {
        // Random walk: change direction slightly
        agent.speedLat += ((Math.random() - 0.5) * 0.5) / metersPerDegreeLat;
        agent.speedLng += ((Math.random() - 0.5) * 0.5) / metersPerDegreeLng;

        // Clamp speed to realistic walking pace (~1.5 m/s max)
        const maxSpeedDeg = 1.5 / metersPerDegreeLat;
        agent.speedLat = Math.max(-maxSpeedDeg, Math.min(maxSpeedDeg, agent.speedLat));
        agent.speedLng = Math.max(-maxSpeedDeg, Math.min(maxSpeedDeg, agent.speedLng));

        agent.lat += agent.speedLat * (interval / 1000);
        agent.lng += agent.speedLng * (interval / 1000);

        // Bounce back if straying too far from centre (~300m)
        const distLat = Math.abs(agent.lat - ZITF_CENTER.lat) * metersPerDegreeLat;
        const distLng = Math.abs(agent.lng - ZITF_CENTER.lng) * metersPerDegreeLng;
        if (distLat > 300) agent.speedLat *= -1;
        if (distLng > 300) agent.speedLng *= -1;

        try {
          await this.tracking.processLocationUpdate(agent.id, {
            latitude: agent.lat,
            longitude: agent.lng,
            accuracy: 5 + Math.random() * 10,
            speed: Math.sqrt(
              (agent.speedLat * metersPerDegreeLat) ** 2 +
                (agent.speedLng * metersPerDegreeLng) ** 2,
            ),
            heading: Math.random() * 360,
            recordedAt: new Date().toISOString(),
            idempotencyKey: `walk-${agent.id}-${ticksDone}`,
          } as any);
        } catch {
          // ignore individual failures
        }
      }
    }, interval);

    return {
      started: true,
      agents: count,
      durationSeconds: duration,
      intervalMs: interval,
      totalTicks: ticks,
      message: `Simulation running: ${count} agents for ${duration}s. Heatmap will update live.`,
    };
  }

  // =====================================================
  // Venue Zones Management
  // =====================================================

  @Post('zones/sync-from-halls')
  @ApiOperation({
    summary: 'Sync venue zones from existing halls/stands geo_polygon data',
    description: 'Creates venue_zones from halls that have geo_polygon defined',
  })
  async syncZonesFromHalls() {
    const db = this.supabase.getAdminClient();

    // Fetch halls with geo_polygons
    const { data: halls, error: hallsError } = await db
      .from('halls')
      .select('id, name, geo_polygon')
      .eq('is_active', true)
      .not('geo_polygon', 'is', null);

    if (hallsError || !halls) {
      return { error: 'Failed to fetch halls', synced: 0 };
    }

    let synced = 0;

    for (const hall of halls) {
      if (!hall.geo_polygon || !Array.isArray(hall.geo_polygon) || hall.geo_polygon.length < 3) {
        continue;
      }

      // Convert [lat, lng] pairs to WKT polygon
      // geo_polygon is stored as [[lat, lng], [lat, lng], ...]
      const coords = hall.geo_polygon as number[][];
      const wktCoords = coords
        .map((p: number[]) => `${p[1]} ${p[0]}`) // WKT uses lng lat order
        .join(', ');
      // Close the polygon by repeating the first point
      const firstPoint = `${coords[0][1]} ${coords[0][0]}`;
      const wkt = `SRID=4326;POLYGON((${wktCoords}, ${firstPoint}))`;

      // Upsert venue zone for this hall
      const { error } = await db.from('venue_zones').upsert(
        {
          hall_id: hall.id,
          name: hall.name,
          zone_type: 'hall',
          boundary: wkt,
          is_active: true,
        },
        { onConflict: 'hall_id' },
      );

      if (!error) synced++;
    }

    return { synced, total: halls.length };
  }
}
