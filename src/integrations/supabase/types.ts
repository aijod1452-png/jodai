export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          created_at: string
          description: string
          details: Json
          event_type: string
          id: string
          model_id: string | null
          task_id: string | null
          tool_id: string | null
        }
        Insert: {
          created_at?: string
          description: string
          details?: Json
          event_type: string
          id?: string
          model_id?: string | null
          task_id?: string | null
          tool_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          details?: Json
          event_type?: string
          id?: string
          model_id?: string | null
          task_id?: string | null
          tool_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      api_tokens: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_used_at: string | null
          name: string
          token_hash: string
          token_prefix: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name: string
          token_hash: string
          token_prefix: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name?: string
          token_hash?: string
          token_prefix?: string
        }
        Relationships: []
      }
      health_checks: {
        Row: {
          checked_at: string
          details: Json
          id: string
          status: string
        }
        Insert: {
          checked_at?: string
          details?: Json
          id?: string
          status: string
        }
        Update: {
          checked_at?: string
          details?: Json
          id?: string
          status?: string
        }
        Relationships: []
      }
      models: {
        Row: {
          capabilities: Json
          cooldown_until: string | null
          created_at: string
          display_name: string
          id: string
          in_cooldown: boolean
          is_enabled: boolean
          model_id: string
          priority: number
          provider_id: string
        }
        Insert: {
          capabilities?: Json
          cooldown_until?: string | null
          created_at?: string
          display_name: string
          id?: string
          in_cooldown?: boolean
          is_enabled?: boolean
          model_id: string
          priority?: number
          provider_id: string
        }
        Update: {
          capabilities?: Json
          cooldown_until?: string | null
          created_at?: string
          display_name?: string
          id?: string
          in_cooldown?: boolean
          is_enabled?: boolean
          model_id?: string
          priority?: number
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          reference_id: string | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          reference_id?: string | null
          title: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          reference_id?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      provider_secrets: {
        Row: {
          api_key: string | null
          encrypted_secret: string | null
          encryption_iv: string | null
          masked_key: string
          provider_id: string
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          encrypted_secret?: string | null
          encryption_iv?: string | null
          masked_key: string
          provider_id: string
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          encrypted_secret?: string | null
          encryption_iv?: string | null
          masked_key?: string
          provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_secrets_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          base_url: string
          created_at: string
          custom_headers: Json
          id: string
          is_enabled: boolean
          last_test_latency_ms: number | null
          last_test_result: string | null
          last_tested_at: string | null
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          base_url: string
          created_at?: string
          custom_headers?: Json
          id?: string
          is_enabled?: boolean
          last_test_latency_ms?: number | null
          last_test_result?: string | null
          last_tested_at?: string | null
          name: string
          type: string
          updated_at?: string
        }
        Update: {
          base_url?: string
          created_at?: string
          custom_headers?: Json
          id?: string
          is_enabled?: boolean
          last_test_latency_ms?: number | null
          last_test_result?: string | null
          last_tested_at?: string | null
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      router_state: {
        Row: {
          cooldown_duration_seconds: number
          fallback_order: Json
          id: string
          last_fallback_event: string | null
          last_fallback_reason: string | null
          updated_at: string
        }
        Insert: {
          cooldown_duration_seconds?: number
          fallback_order?: Json
          id?: string
          last_fallback_event?: string | null
          last_fallback_reason?: string | null
          updated_at?: string
        }
        Update: {
          cooldown_duration_seconds?: number
          fallback_order?: Json
          id?: string
          last_fallback_event?: string | null
          last_fallback_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      schedule_runs: {
        Row: {
          error_message: string | null
          executed_at: string
          id: string
          schedule_id: string
          status: string
          task_id: string | null
        }
        Insert: {
          error_message?: string | null
          executed_at?: string
          id?: string
          schedule_id: string
          status: string
          task_id?: string | null
        }
        Update: {
          error_message?: string | null
          executed_at?: string
          id?: string
          schedule_id?: string
          status?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_runs_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_runs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          command: string
          created_at: string
          cron_expression: string | null
          id: string
          is_enabled: boolean
          last_run_at: string | null
          last_run_status: string | null
          name: string
          next_run_at: string | null
          run_once_at: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          command: string
          created_at?: string
          cron_expression?: string | null
          id?: string
          is_enabled?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          name: string
          next_run_at?: string | null
          run_once_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          command?: string
          created_at?: string
          cron_expression?: string | null
          id?: string
          is_enabled?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          name?: string
          next_run_at?: string | null
          run_once_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          ip_address: string | null
          last_active_at: string
          token_hash: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          ip_address?: string | null
          last_active_at?: string
          token_hash: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          last_active_at?: string
          token_hash?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          created_at: string
          failed_attempts: number
          id: string
          is_initialized: boolean
          locked_until: string | null
          master_pause: boolean
          max_steps_per_task: number
          passcode_hash: string | null
          passcode_salt: string | null
          theme: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          failed_attempts?: number
          id?: string
          is_initialized?: boolean
          locked_until?: string | null
          master_pause?: boolean
          max_steps_per_task?: number
          passcode_hash?: string | null
          passcode_salt?: string | null
          theme?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          failed_attempts?: number
          id?: string
          is_initialized?: boolean
          locked_until?: string | null
          master_pause?: boolean
          max_steps_per_task?: number
          passcode_hash?: string | null
          passcode_salt?: string | null
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      storage_connections: {
        Row: {
          bucket_name: string | null
          created_at: string
          id: string
          is_enabled: boolean
          last_test_result: string | null
          last_tested_at: string | null
          name: string
          project_url: string
          updated_at: string
        }
        Insert: {
          bucket_name?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_test_result?: string | null
          last_tested_at?: string | null
          name: string
          project_url: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          last_test_result?: string | null
          last_tested_at?: string | null
          name?: string
          project_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      storage_secrets: {
        Row: {
          encrypted_secret: string | null
          encryption_iv: string | null
          masked_key: string
          service_role_key: string | null
          storage_id: string
          updated_at: string
        }
        Insert: {
          encrypted_secret?: string | null
          encryption_iv?: string | null
          masked_key: string
          service_role_key?: string | null
          storage_id: string
          updated_at?: string
        }
        Update: {
          encrypted_secret?: string | null
          encryption_iv?: string | null
          masked_key?: string
          service_role_key?: string | null
          storage_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_secrets_storage_id_fkey"
            columns: ["storage_id"]
            isOneToOne: true
            referencedRelation: "storage_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      task_steps: {
        Row: {
          action_type: string
          attempts: number
          checkpoint_state: Json | null
          completed_at: string | null
          created_at: string
          description: string
          error_message: string | null
          expected_output: string | null
          id: string
          input_payload: Json
          output_payload: Json | null
          started_at: string | null
          status: string
          step_number: number
          target_id: string | null
          task_id: string
        }
        Insert: {
          action_type: string
          attempts?: number
          checkpoint_state?: Json | null
          completed_at?: string | null
          created_at?: string
          description: string
          error_message?: string | null
          expected_output?: string | null
          id?: string
          input_payload?: Json
          output_payload?: Json | null
          started_at?: string | null
          status?: string
          step_number: number
          target_id?: string | null
          task_id: string
        }
        Update: {
          action_type?: string
          attempts?: number
          checkpoint_state?: Json | null
          completed_at?: string | null
          created_at?: string
          description?: string
          error_message?: string | null
          expected_output?: string | null
          id?: string
          input_payload?: Json
          output_payload?: Json | null
          started_at?: string | null
          status?: string
          step_number?: number
          target_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_steps_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: number
          failure_reason: string | null
          goal: string
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          lease_token: string | null
          model_selection_reason: string | null
          result_summary: string | null
          selected_model_id: string | null
          started_at: string | null
          status: string
          target_reference: Json | null
          total_steps: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          failure_reason?: string | null
          goal: string
          id?: string
          idempotency_key: string
          lease_expires_at?: string | null
          lease_token?: string | null
          model_selection_reason?: string | null
          result_summary?: string | null
          selected_model_id?: string | null
          started_at?: string | null
          status?: string
          target_reference?: Json | null
          total_steps?: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          failure_reason?: string | null
          goal?: string
          id?: string
          idempotency_key?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          model_selection_reason?: string | null
          result_summary?: string | null
          selected_model_id?: string | null
          started_at?: string | null
          status?: string
          target_reference?: Json | null
          total_steps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_selected_model_id_fkey"
            columns: ["selected_model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_secrets: {
        Row: {
          api_key: string | null
          encrypted_secret: string | null
          encryption_iv: string | null
          masked_key: string
          tool_id: string
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          encrypted_secret?: string | null
          encryption_iv?: string | null
          masked_key: string
          tool_id: string
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          encrypted_secret?: string | null
          encryption_iv?: string | null
          masked_key?: string
          tool_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_secrets_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: true
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      tools: {
        Row: {
          auth_header_type: string
          base_url: string
          created_at: string
          custom_header_name: string | null
          description: string
          id: string
          is_enabled: boolean
          last_test_latency_ms: number | null
          last_test_result: string | null
          last_tested_at: string | null
          name: string
          sample_request: Json | null
          updated_at: string
        }
        Insert: {
          auth_header_type?: string
          base_url: string
          created_at?: string
          custom_header_name?: string | null
          description: string
          id?: string
          is_enabled?: boolean
          last_test_latency_ms?: number | null
          last_test_result?: string | null
          last_tested_at?: string | null
          name: string
          sample_request?: Json | null
          updated_at?: string
        }
        Update: {
          auth_header_type?: string
          base_url?: string
          created_at?: string
          custom_header_name?: string | null
          description?: string
          id?: string
          is_enabled?: boolean
          last_test_latency_ms?: number | null
          last_test_result?: string | null
          last_tested_at?: string | null
          name?: string
          sample_request?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      usage_records: {
        Row: {
          completion_tokens: number
          cost: number
          created_at: string
          id: string
          is_estimated: boolean
          model_id: string
          prompt_tokens: number
          provider_id: string | null
          task_id: string | null
        }
        Insert: {
          completion_tokens?: number
          cost?: number
          created_at?: string
          id?: string
          is_estimated?: boolean
          model_id: string
          prompt_tokens?: number
          provider_id?: string | null
          task_id?: string | null
        }
        Update: {
          completion_tokens?: number
          cost?: number
          created_at?: string
          id?: string
          is_estimated?: boolean
          model_id?: string
          prompt_tokens?: number
          provider_id?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_next_task: {
        Args: { lease_seconds?: number }
        Returns: {
          completed_at: string | null
          created_at: string
          current_step: number
          failure_reason: string | null
          goal: string
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          lease_token: string | null
          model_selection_reason: string | null
          result_summary: string | null
          selected_model_id: string | null
          started_at: string | null
          status: string
          target_reference: Json | null
          total_steps: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
