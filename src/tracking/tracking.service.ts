import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service.js';
import { LocationUpdateDto } from './dto/location-update.dto.js';

export interface ProcessedLocation {
  visitorHash: string;
  visitorId: string | null;
  latitude: number;
  longitude: number;
  accuracy: number;
  recordedAt: string;
  zones: { zone_id: string; zone_name: string; zone_type: string }[];
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);
  private canUseExecSqlRpc = true;

  // In-memory state for real-time tracking (replaced by Redis in production)
  // Key: visitorHash, Value: latest location + metadata
  private activeUsers = new Map<
    string,
    {
      latitude: number;
      longitude: number;
      accuracy: number;
      lastSeen: Date;
      zones: string[];
    }
  >();

  // Batch buffer for database writes
  private locationBuffer: Array<{
    visitor_hash: string;
    visitor_id: string | null;
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    speed: number | null;
    heading: number | null;
    network_type: string | null;
    wifi_ssid: string | null;
    signal_strength: number | null;
    recorded_at: string;
    idempotency_key: string | null;
  }> = [];

  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly supabase: SupabaseService) {
    // Flush location buffer every 3 seconds
    this.flushTimer = setInterval(() => this.flushLocationBuffer(), 3000);

    // Clean stale active users every 60 seconds
    setInterval(() => this.cleanStaleUsers(), 60000);
  }

  /**
   * Hash visitor ID for privacy (SHA-256)
   */
  hashVisitorId(visitorId: string): string {
    return createHash('sha256').update(visitorId).digest('hex').substring(0, 16);
  }

  /**
   * Process a single location update from a visitor
   */
  async processLocationUpdate(
    visitorId: string,
    update: LocationUpdateDto,
  ): Promise<ProcessedLocation> {
    const visitorHash = this.hashVisitorId(visitorId);

    // Update in-memory state
    const zones = await this.resolveZones(update.latitude, update.longitude);
    this.activeUsers.set(visitorHash, {
      latitude: update.latitude,
      longitude: update.longitude,
      accuracy: update.accuracy,
      lastSeen: new Date(),
      zones: zones.map((z) => z.zone_id),
    });

    // Add to batch buffer for DB write
    this.locationBuffer.push({
      visitor_hash: visitorHash,
      visitor_id: visitorId,
      latitude: update.latitude,
      longitude: update.longitude,
      accuracy: update.accuracy,
      altitude: update.altitude ?? null,
      speed: update.speed ?? null,
      heading: update.heading ?? null,
      network_type: update.networkType ?? null,
      wifi_ssid: update.wifiSsid ?? null,
      signal_strength: update.signalStrength ?? null,
      recorded_at: update.recordedAt,
      idempotency_key: update.idempotencyKey ?? null,
    });

    return {
      visitorHash,
      visitorId,
      latitude: update.latitude,
      longitude: update.longitude,
      accuracy: update.accuracy,
      recordedAt: update.recordedAt,
      zones,
    };
  }

  /**
   * Process batch of location updates (for REST fallback / offline sync)
   */
  async processBatchUpdate(
    visitorId: string,
    updates: LocationUpdateDto[],
  ): Promise<{ processed: number; errors: number }> {
    let processed = 0;
    let errors = 0;

    for (const update of updates) {
      try {
        await this.processLocationUpdate(visitorId, update);
        processed++;
      } catch (err) {
        this.logger.warn(`Failed to process location update: ${err}`);
        errors++;
      }
    }

    // Force flush after batch
    await this.flushLocationBuffer();
    return { processed, errors };
  }

  /**
   * Resolve which venue zones contain a given point
   */
  private async resolveZones(
    lat: number,
    lng: number,
  ): Promise<{ zone_id: string; zone_name: string; zone_type: string }[]> {
    try {
      const db = this.supabase.getAdminClient();
      const { data, error } = await db.rpc('get_zone_for_point', {
        lat,
        lng,
      });

      if (error) {
        this.logger.warn(`Zone resolution failed: ${error.message}`);
        return [];
      }

      return data || [];
    } catch {
      return [];
    }
  }

  /**
   * Flush buffered locations to database in batch
   */
  private async flushLocationBuffer(): Promise<void> {
    if (this.locationBuffer.length === 0) return;

    const batch = [...this.locationBuffer];
    this.locationBuffer = [];

    try {
      const db = this.supabase.getAdminClient();

      // Build raw SQL for batch insert with PostGIS geometry
      const values = batch
        .map(
          (loc) =>
            `(
          '${loc.visitor_hash}',
          ${loc.visitor_id ? `'${loc.visitor_id}'` : 'NULL'},
          ST_SetSRID(ST_MakePoint(${loc.longitude}, ${loc.latitude}), 4326),
          ${loc.latitude},
          ${loc.longitude},
          ${loc.accuracy},
          ${loc.altitude ?? 'NULL'},
          ${loc.speed ?? 'NULL'},
          ${loc.heading ?? 'NULL'},
          ${loc.network_type ? `'${loc.network_type}'` : 'NULL'},
          ${loc.wifi_ssid ? `'${loc.wifi_ssid.replace(/'/g, "''")}'` : 'NULL'},
          ${loc.signal_strength ?? 'NULL'},
          '${loc.recorded_at}',
          ${loc.idempotency_key ? `'${loc.idempotency_key}'` : 'NULL'}
        )`,
        )
        .join(',\n');

      const sql = `
        INSERT INTO location_logs (
          visitor_hash, visitor_id, location, latitude, longitude,
          accuracy, altitude, speed, heading,
          network_type, wifi_ssid, signal_strength,
          recorded_at, idempotency_key
        ) VALUES ${values}
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
        DO NOTHING
      `;

      const rpcResult = this.canUseExecSqlRpc
        ? await db.rpc('exec_sql', { sql_query: sql }).maybeSingle()
        : { error: new Error('exec_sql RPC disabled') as any };

      const { error } = rpcResult;

      if (error) {
        if (
          this.canUseExecSqlRpc &&
          error.message?.includes('Could not find the function public.exec_sql')
        ) {
          this.canUseExecSqlRpc = false;
          this.logger.warn('exec_sql RPC not available. Switching to PostgREST fallback for future batches.');
        }

        // Fallback: insert via PostgREST without geometry (will need a trigger to compute it)
        this.logger.warn(`Batch SQL insert failed: ${error.message}. Falling back to PostgREST.`);
        await this.fallbackInsert(batch);
      } else {
        this.logger.debug(`Flushed ${batch.length} location records`);
      }
    } catch (err) {
      this.logger.error(`Location buffer flush failed: ${err}`);
      // Re-queue the batch
      this.locationBuffer.unshift(...batch);
    }
  }

  /**
   * Fallback insert using PostgREST (without PostGIS geometry column)
   */
  private async fallbackInsert(
    batch: typeof this.locationBuffer,
  ): Promise<void> {
    const db = this.supabase.getAdminClient();
    const rows = batch.map((loc) => ({
      visitor_hash: loc.visitor_hash,
      visitor_id: loc.visitor_id,
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
      altitude: loc.altitude,
      speed: loc.speed,
      heading: loc.heading,
      network_type: loc.network_type,
      wifi_ssid: loc.wifi_ssid,
      signal_strength: loc.signal_strength,
      recorded_at: loc.recorded_at,
      idempotency_key: loc.idempotency_key,
    }));

    const { error } = await db.from('location_logs').upsert(rows, {
      onConflict: 'idempotency_key',
      ignoreDuplicates: true,
    });

    if (!error) return;

    const missingConflictConstraint =
      error.message?.includes(
        'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      ) ?? false;

    if (!missingConflictConstraint) {
      this.logger.error(`Fallback insert also failed: ${error.message}`);
      return;
    }

    this.logger.warn(
      'Fallback upsert conflict target unavailable on location_logs; retrying plain insert without ON CONFLICT.',
    );

    const { error: insertError } = await db.from('location_logs').insert(rows);
    if (insertError) {
      this.logger.error(`Fallback plain insert failed: ${insertError.message}`);
    }
  }

  /**
   * Remove users who haven't sent a location in 5+ minutes
   */
  private cleanStaleUsers(): void {
    const staleThreshold = Date.now() - 5 * 60 * 1000;
    let removed = 0;

    for (const [hash, data] of this.activeUsers.entries()) {
      if (data.lastSeen.getTime() < staleThreshold) {
        this.activeUsers.delete(hash);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`Cleaned ${removed} stale user locations`);
    }
  }

  /**
   * Get all currently active user locations (for real-time heatmap)
   */
  getActiveLocations(): Array<{
    latitude: number;
    longitude: number;
    accuracy: number;
    zones: string[];
  }> {
    return Array.from(this.activeUsers.values());
  }

  /**
   * Get active user count
   */
  getActiveUserCount(): number {
    return this.activeUsers.size;
  }

  /**
   * Get active users per zone
   */
  getActiveUsersByZone(): Map<string, number> {
    const zoneCounts = new Map<string, number>();
    for (const user of this.activeUsers.values()) {
      for (const zoneId of user.zones) {
        zoneCounts.set(zoneId, (zoneCounts.get(zoneId) || 0) + 1);
      }
    }
    return zoneCounts;
  }
}
