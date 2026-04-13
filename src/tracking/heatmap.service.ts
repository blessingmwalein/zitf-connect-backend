import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { TrackingService } from './tracking.service.js';

export interface HeatmapPoint {
  lat: number;
  lng: number;
  intensity: number;
}

export interface ZoneTraffic {
  zone_id: string;
  zone_name: string;
  zone_type: string;
  visitor_count: number;
  unique_visitors: number;
  avg_dwell_seconds: number;
  capacity?: number;
  fill_rate?: number;
}

export interface ZoneOccupancySnapshot {
  zone_id: string;
  zone_name: string;
  time_bucket: string;
  current_count: number;
  peak_count: number;
  unique_visitors: number;
}

@Injectable()
export class HeatmapService {
  private readonly logger = new Logger(HeatmapService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly tracking: TrackingService,
  ) {}

  /**
   * Get real-time heatmap data from active in-memory locations
   * Used for live mode (sub-second updates via WebSocket)
   */
  getLiveHeatmapData(): HeatmapPoint[] {
    const activeLocations = this.tracking.getActiveLocations();
    return activeLocations.map((loc) => ({
      lat: loc.latitude,
      lng: loc.longitude,
      intensity: Math.max(0.3, 1.0 - (loc.accuracy / 100)), // Higher accuracy = higher intensity
    }));
  }

  /**
   * Get heatmap data from database for a viewport and time range
   * Used for historical playback and time-filtered views
   */
  async getHistoricalHeatmapData(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number,
    since?: string,
    until?: string,
  ): Promise<HeatmapPoint[]> {
    const db = this.supabase.getAdminClient();

    const sinceTime = since || new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const untilTime = until || new Date().toISOString();

    try {
      const { data, error } = await db.rpc('get_heatmap_data', {
        p_min_lat: minLat,
        p_min_lng: minLng,
        p_max_lat: maxLat,
        p_max_lng: maxLng,
        p_since: sinceTime,
        p_until: untilTime,
      });

      if (error) {
        this.logger.error(`Heatmap query failed: ${error.message}`);
        return [];
      }

      return (data || []).map((row: { lat: number; lng: number; intensity: number }) => ({
        lat: row.lat,
        lng: row.lng,
        intensity: Math.max(0.1, Math.min(1.0, row.intensity)),
      }));
    } catch (err) {
      this.logger.error(`Heatmap data fetch error: ${err}`);
      return [];
    }
  }

  /**
   * Get zone traffic summary (for admin analytics)
   */
  async getZoneTraffic(since?: string, zoneType?: string): Promise<ZoneTraffic[]> {
    const db = this.supabase.getAdminClient();
    const sinceTime = since || new Date(Date.now() - 60 * 60 * 1000).toISOString();

    try {
      const { data, error } = await db.rpc('get_zone_traffic_summary', {
        p_since: sinceTime,
      });

      if (error) {
        this.logger.error(`Zone traffic query failed: ${error.message}`);
        return [];
      }

      let results = (data || []) as ZoneTraffic[];

      if (zoneType) {
        results = results.filter((z) => z.zone_type === zoneType);
      }

      // Enrich with capacity data from venue_zones
      const { data: zones } = await db
        .from('venue_zones')
        .select('id, capacity')
        .in(
          'id',
          results.map((r) => r.zone_id),
        );

      if (zones) {
        const capacityMap = new Map(zones.map((z) => [z.id, z.capacity]));
        results = results.map((r) => ({
          ...r,
          capacity: capacityMap.get(r.zone_id) || undefined,
          fill_rate: capacityMap.get(r.zone_id)
            ? (r.unique_visitors / capacityMap.get(r.zone_id)!) * 100
            : undefined,
        }));
      }

      return results;
    } catch (err) {
      this.logger.error(`Zone traffic fetch error: ${err}`);
      return [];
    }
  }

  /**
   * Get live zone occupancy (from in-memory state)
   */
  getLiveZoneOccupancy(): Array<{ zoneId: string; count: number }> {
    const zoneCounts = this.tracking.getActiveUsersByZone();
    return Array.from(zoneCounts.entries()).map(([zoneId, count]) => ({
      zoneId,
      count,
    }));
  }

  /**
   * Get historical zone occupancy over time (for timeline charts)
   */
  async getZoneOccupancyTimeline(
    startDate: string,
    endDate: string,
    zoneId?: string,
    intervalMinutes = 60,
  ): Promise<ZoneOccupancySnapshot[]> {
    const db = this.supabase.getAdminClient();

    try {
      let query = db
        .from('zone_occupancy')
        .select(
          `
          zone_id,
          time_bucket,
          current_count,
          peak_count,
          unique_visitors,
          venue_zones(name)
        `,
        )
        .gte('time_bucket', startDate)
        .lte('time_bucket', endDate)
        .order('time_bucket', { ascending: true });

      if (zoneId) {
        query = query.eq('zone_id', zoneId);
      }

      const { data, error } = await query;

      if (error) {
        this.logger.error(`Zone occupancy timeline query failed: ${error.message}`);
        return [];
      }

      return (data || []).map((row: any) => ({
        zone_id: row.zone_id,
        zone_name: row.venue_zones?.name || 'Unknown',
        time_bucket: row.time_bucket,
        current_count: row.current_count,
        peak_count: row.peak_count,
        unique_visitors: row.unique_visitors,
      }));
    } catch (err) {
      this.logger.error(`Zone occupancy timeline error: ${err}`);
      return [];
    }
  }

  /**
   * Get peak times for a zone or all zones
   */
  async getPeakTimes(
    zoneId?: string,
    days = 7,
  ): Promise<
    Array<{
      zone_name: string;
      hour: number;
      unique_visitors: number;
    }>
  > {
    const db = this.supabase.getAdminClient();

    try {
      // Query the materialized view
      let query = db
        .from('mv_hourly_zone_traffic')
        .select('zone_name, hour, unique_visitors')
        .order('unique_visitors', { ascending: false });

      if (zoneId) {
        query = query.eq('zone_id', zoneId);
      }

      const { data, error } = await query;

      if (error) {
        // Materialized view might not be refreshed; fall back to zone_occupancy
        this.logger.warn(`Peak times query failed: ${error.message}`);
        return [];
      }

      return (data || []).map((row: any) => ({
        zone_name: row.zone_name,
        hour: new Date(row.hour).getHours(),
        unique_visitors: row.unique_visitors,
      }));
    } catch (err) {
      this.logger.error(`Peak times fetch error: ${err}`);
      return [];
    }
  }

  /**
   * Get most popular zones ranked by visitor count
   */
  async getPopularZones(
    since?: string,
    limit = 10,
  ): Promise<
    Array<{
      zone_id: string;
      zone_name: string;
      zone_type: string;
      unique_visitors: number;
      avg_dwell_minutes: number;
    }>
  > {
    const traffic = await this.getZoneTraffic(since);

    return traffic
      .sort((a, b) => b.unique_visitors - a.unique_visitors)
      .slice(0, limit)
      .map((z) => ({
        zone_id: z.zone_id,
        zone_name: z.zone_name,
        zone_type: z.zone_type,
        unique_visitors: z.unique_visitors,
        avg_dwell_minutes: Math.round((z.avg_dwell_seconds / 60) * 10) / 10,
      }));
  }

  /**
   * Get venue-wide stats summary
   */
  getVenueStats(): {
    activeUsers: number;
    liveZoneOccupancy: Array<{ zoneId: string; count: number }>;
  } {
    return {
      activeUsers: this.tracking.getActiveUserCount(),
      liveZoneOccupancy: this.getLiveZoneOccupancy(),
    };
  }
}
