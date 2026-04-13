import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { TrackingService } from './tracking.service.js';
import { HeatmapService } from './heatmap.service.js';
import { LocationUpdateDto } from './dto/location-update.dto.js';
import { SupabaseService } from '../supabase/supabase.service.js';

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)) || [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'https://zitf-connect-admin.vercel.app',
];

/**
 * WebSocket Gateway for real-time location tracking.
 *
 * Events (Client -> Server):
 *   - location:update     — Single GPS update from mobile device
 *   - location:batch      — Batch of buffered locations (offline sync)
 *   - tracking:start      — Client begins sharing location
 *   - tracking:stop       — Client stops sharing location
 *   - heatmap:subscribe   — Admin subscribes to live heatmap updates
 *   - heatmap:unsubscribe — Admin unsubscribes from heatmap
 *
 * Events (Server -> Client):
 *   - heatmap:update      — Pushed to admins with latest heatmap data
 *   - zone:update         — Pushed to admins with zone occupancy changes
 *   - stats:update        — Pushed to admins with venue-wide stats
 *   - tracking:ack        — Acknowledgement of location update
 *   - error               — Error notification
 */
@WebSocketGateway({
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
  namespace: '/tracking',
  transports: ['websocket', 'polling'],
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TrackingGateway.name);

  // Track connected clients
  private connectedClients = new Map<
    string,
    {
      visitorId: string | null;
      role: 'visitor' | 'admin';
      isTracking: boolean;
    }
  >();

  // Heatmap broadcast interval
  private heatmapInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly tracking: TrackingService,
    private readonly heatmap: HeatmapService,
    private readonly supabase: SupabaseService,
  ) {}

  afterInit() {
    this.logger.log('Tracking WebSocket Gateway initialized');

    // Broadcast heatmap to subscribed admins every 2 seconds
    this.heatmapInterval = setInterval(() => {
      this.broadcastHeatmap();
    }, 2000);
  }

  async handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);

    // Extract auth token from handshake
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    let visitorId: string | null = null;
    let role: 'visitor' | 'admin' = 'visitor';

    if (token) {
      try {
        // Verify token with Supabase
        const {
          data: { user },
          error,
        } = await this.supabase.getAdminClient().auth.getUser(token);

        if (!error && user) {
          visitorId = user.id;

          // Check if user is admin (has profile in profiles table)
          const { data: profile } = await this.supabase
            .getAdminClient()
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();

          if (profile) {
            role = 'admin';
            client.join('admins');
          }
        }
      } catch (err) {
        this.logger.warn(`Auth verification failed for ${client.id}: ${err}`);
      }
    }

    this.connectedClients.set(client.id, {
      visitorId,
      role,
      isTracking: false,
    });

    client.emit('connected', {
      clientId: client.id,
      role,
      authenticated: !!visitorId,
    });
  }

  handleDisconnect(client: Socket) {
    const clientData = this.connectedClients.get(client.id);
    this.connectedClients.delete(client.id);
    this.logger.debug(
      `Client disconnected: ${client.id} (${clientData?.role || 'unknown'})`,
    );
  }

  /**
   * Handle single location update from mobile device
   */
  @SubscribeMessage('location:update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: LocationUpdateDto,
  ) {
    const clientData = this.connectedClients.get(client.id);

    if (!clientData?.visitorId) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    if (!clientData.isTracking) {
      client.emit('error', { message: 'Tracking not started. Send tracking:start first.' });
      return;
    }

    try {
      const result = await this.tracking.processLocationUpdate(clientData.visitorId, data);

      // Acknowledge the update
      client.emit('tracking:ack', {
        idempotencyKey: data.idempotencyKey,
        timestamp: new Date().toISOString(),
        zones: result.zones.map((z) => z.zone_name),
      });
    } catch (err) {
      this.logger.error(`Location update error: ${err}`);
      client.emit('error', { message: 'Failed to process location update' });
    }
  }

  /**
   * Handle batch location update (offline sync)
   */
  @SubscribeMessage('location:batch')
  async handleBatchUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { locations: LocationUpdateDto[] },
  ) {
    const clientData = this.connectedClients.get(client.id);

    if (!clientData?.visitorId) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    try {
      const result = await this.tracking.processBatchUpdate(
        clientData.visitorId,
        data.locations,
      );

      client.emit('tracking:batch-ack', {
        processed: result.processed,
        errors: result.errors,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(`Batch update error: ${err}`);
      client.emit('error', { message: 'Failed to process batch update' });
    }
  }

  /**
   * Client starts sharing location
   */
  @SubscribeMessage('tracking:start')
  handleTrackingStart(@ConnectedSocket() client: Socket) {
    const clientData = this.connectedClients.get(client.id);

    if (!clientData?.visitorId) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    clientData.isTracking = true;
    client.join('trackers');
    this.logger.debug(`Tracking started: ${client.id}`);

    client.emit('tracking:started', { timestamp: new Date().toISOString() });
  }

  /**
   * Client stops sharing location
   */
  @SubscribeMessage('tracking:stop')
  handleTrackingStop(@ConnectedSocket() client: Socket) {
    const clientData = this.connectedClients.get(client.id);

    if (clientData) {
      clientData.isTracking = false;
    }

    client.leave('trackers');
    this.logger.debug(`Tracking stopped: ${client.id}`);

    client.emit('tracking:stopped', { timestamp: new Date().toISOString() });
  }

  /**
   * Admin subscribes to live heatmap updates
   */
  @SubscribeMessage('heatmap:subscribe')
  handleHeatmapSubscribe(@ConnectedSocket() client: Socket) {
    const clientData = this.connectedClients.get(client.id);

    if (clientData?.role !== 'admin') {
      client.emit('error', { message: 'Admin access required' });
      return;
    }

    client.join('heatmap-subscribers');
    this.logger.debug(`Heatmap subscription: ${client.id}`);

    // Send initial data immediately
    const heatmapData = this.heatmap.getLiveHeatmapData();
    const stats = this.heatmap.getVenueStats();

    client.emit('heatmap:update', { points: heatmapData, timestamp: new Date().toISOString() });
    client.emit('stats:update', stats);
  }

  /**
   * Admin unsubscribes from live heatmap
   */
  @SubscribeMessage('heatmap:unsubscribe')
  handleHeatmapUnsubscribe(@ConnectedSocket() client: Socket) {
    client.leave('heatmap-subscribers');
    this.logger.debug(`Heatmap unsubscription: ${client.id}`);
  }

  /**
   * Broadcast heatmap data to all subscribed admins
   */
  private broadcastHeatmap() {
    const subscriberRoom = this.server?.to('heatmap-subscribers');
    if (!subscriberRoom) return;

    const heatmapData = this.heatmap.getLiveHeatmapData();
    const stats = this.heatmap.getVenueStats();
    const zoneOccupancy = this.heatmap.getLiveZoneOccupancy();

    subscriberRoom.emit('heatmap:update', {
      points: heatmapData,
      timestamp: new Date().toISOString(),
    });

    subscriberRoom.emit('stats:update', {
      ...stats,
      connectedClients: this.connectedClients.size,
      trackingClients: Array.from(this.connectedClients.values()).filter(
        (c) => c.isTracking,
      ).length,
    });

    if (zoneOccupancy.length > 0) {
      subscriberRoom.emit('zone:update', {
        zones: zoneOccupancy,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
