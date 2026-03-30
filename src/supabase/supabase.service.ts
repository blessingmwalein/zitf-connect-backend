import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client: SupabaseClient;
  private adminClient: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('supabase.url')!;
    const anonKey = this.configService.get<string>('supabase.anonKey')!;
    const serviceRoleKey = this.configService.get<string>('supabase.serviceRoleKey');

    this.client = createClient(url, anonKey);

    if (serviceRoleKey && serviceRoleKey !== 'your-service-role-key') {
      this.adminClient = createClient(url, serviceRoleKey);
    } else {
      this.adminClient = this.client;
    }
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  getAdminClient(): SupabaseClient {
    return this.adminClient;
  }
}
