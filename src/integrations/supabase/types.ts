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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      airdrop_projects: {
        Row: {
          chain: string | null
          confidence_score: number
          created_at: string
          distribution_date: string | null
          eligibility_requirements: string | null
          id: string
          official_url: string | null
          project_name: string
          snapshot_date: string | null
          token_symbol: string | null
        }
        Insert: {
          chain?: string | null
          confidence_score?: number
          created_at?: string
          distribution_date?: string | null
          eligibility_requirements?: string | null
          id?: string
          official_url?: string | null
          project_name: string
          snapshot_date?: string | null
          token_symbol?: string | null
        }
        Update: {
          chain?: string | null
          confidence_score?: number
          created_at?: string
          distribution_date?: string | null
          eligibility_requirements?: string | null
          id?: string
          official_url?: string | null
          project_name?: string
          snapshot_date?: string | null
          token_symbol?: string | null
        }
        Relationships: []
      }
      airdrop_tasks: {
        Row: {
          created_at: string
          deadline: string | null
          description: string
          id: string
          project_id: string
          required: boolean
          task_type: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          description: string
          id?: string
          project_id: string
          required?: boolean
          task_type: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          description?: string
          id?: string
          project_id?: string
          required?: boolean
          task_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "airdrop_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "airdrop_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          binance_symbol: string | null
          category: string | null
          coingecko_id: string | null
          created_at: string | null
          id: string
          name: string
          precision_price: number | null
          precision_qty: number | null
          symbol: string
        }
        Insert: {
          binance_symbol?: string | null
          category?: string | null
          coingecko_id?: string | null
          created_at?: string | null
          id?: string
          name: string
          precision_price?: number | null
          precision_qty?: number | null
          symbol: string
        }
        Update: {
          binance_symbol?: string | null
          category?: string | null
          coingecko_id?: string | null
          created_at?: string | null
          id?: string
          name?: string
          precision_price?: number | null
          precision_qty?: number | null
          symbol?: string
        }
        Relationships: []
      }
      event_classification: {
        Row: {
          classification: string
          confidence: number
          created_at: string
          event_id: string
          id: string
          reasoning: string | null
          source_id: string | null
          updated_at: string
        }
        Insert: {
          classification?: string
          confidence?: number
          created_at?: string
          event_id: string
          id?: string
          reasoning?: string | null
          source_id?: string | null
          updated_at?: string
        }
        Update: {
          classification?: string
          confidence?: number
          created_at?: string
          event_id?: string
          id?: string
          reasoning?: string | null
          source_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_classification_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "source_reliability"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_connections: {
        Row: {
          api_key: string
          api_secret: string
          created_at: string
          exchange: string
          id: string
          label: string | null
          last_sync: string | null
          passphrase: string | null
          status: string
          sync_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          api_secret: string
          created_at?: string
          exchange: string
          id?: string
          label?: string | null
          last_sync?: string | null
          passphrase?: string | null
          status?: string
          sync_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          api_secret?: string
          created_at?: string
          exchange?: string
          id?: string
          label?: string | null
          last_sync?: string | null
          passphrase?: string | null
          status?: string
          sync_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exchange_sync_logs: {
        Row: {
          created_at: string
          error_message: string | null
          exchange: string
          id: string
          skipped_count: number
          status: string
          synced_count: number
          trigger: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          exchange: string
          id?: string
          skipped_count?: number
          status?: string
          synced_count?: number
          trigger?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          exchange?: string
          id?: string
          skipped_count?: number
          status?: string
          synced_count?: number
          trigger?: string
          user_id?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          accepted_new_count: number | null
          already_imported_count: number | null
          conflict_count: number | null
          content_hash: string | null
          created_at: string | null
          failed_count: number | null
          file_hash: string
          file_name: string
          id: string
          invalid_count: number | null
          parsed_count: number | null
          persisted_count: number | null
          source_exchange: string | null
          source_export_type: string | null
          user_id: string
          warning_count: number | null
        }
        Insert: {
          accepted_new_count?: number | null
          already_imported_count?: number | null
          conflict_count?: number | null
          content_hash?: string | null
          created_at?: string | null
          failed_count?: number | null
          file_hash: string
          file_name: string
          id?: string
          invalid_count?: number | null
          parsed_count?: number | null
          persisted_count?: number | null
          source_exchange?: string | null
          source_export_type?: string | null
          user_id: string
          warning_count?: number | null
        }
        Update: {
          accepted_new_count?: number | null
          already_imported_count?: number | null
          conflict_count?: number | null
          content_hash?: string | null
          created_at?: string | null
          failed_count?: number | null
          file_hash?: string
          file_name?: string
          id?: string
          invalid_count?: number | null
          parsed_count?: number | null
          persisted_count?: number | null
          source_exchange?: string | null
          source_export_type?: string | null
          user_id?: string
          warning_count?: number | null
        }
        Relationships: []
      }
      import_row_fingerprints: {
        Row: {
          canonical_json: string | null
          created_at: string | null
          fingerprint_hash: string
          id: string
          native_id: string | null
          source_exchange: string | null
          source_export_type: string | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          canonical_json?: string | null
          created_at?: string | null
          fingerprint_hash: string
          id?: string
          native_id?: string | null
          source_exchange?: string | null
          source_export_type?: string | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          canonical_json?: string | null
          created_at?: string | null
          fingerprint_hash?: string
          id?: string
          native_id?: string | null
          source_exchange?: string | null
          source_export_type?: string | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_row_fingerprints_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          batch_id: string
          canonical_json: string | null
          created_at: string | null
          fingerprint_hash: string | null
          id: string
          message: string | null
          native_id: string | null
          source_row_index: number
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          batch_id: string
          canonical_json?: string | null
          created_at?: string | null
          fingerprint_hash?: string | null
          id?: string
          message?: string | null
          native_id?: string | null
          source_row_index: number
          status: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          batch_id?: string
          canonical_json?: string | null
          created_at?: string | null
          fingerprint_hash?: string | null
          id?: string
          message?: string | null
          native_id?: string | null
          source_row_index?: number
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      imported_files: {
        Row: {
          exchange: string
          export_type: string
          file_hash: string
          file_name: string
          id: string
          imported_at: string | null
          row_count: number | null
          user_id: string
        }
        Insert: {
          exchange: string
          export_type: string
          file_hash: string
          file_name: string
          id?: string
          imported_at?: string | null
          row_count?: number | null
          user_id: string
        }
        Update: {
          exchange?: string
          export_type?: string
          file_hash?: string
          file_name?: string
          id?: string
          imported_at?: string | null
          row_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      listing_events: {
        Row: {
          announcement_time: string | null
          chain: string | null
          confidence_score: number
          contract_address: string | null
          created_at: string
          dedup_hash: string | null
          detected_time: string
          event_type: string
          exchange: string
          id: string
          lead_time_minutes: number | null
          pair: string | null
          raw_payload: string | null
          source_url: string | null
          status: string
          token_name: string | null
          token_symbol: string
          updated_at: string
        }
        Insert: {
          announcement_time?: string | null
          chain?: string | null
          confidence_score?: number
          contract_address?: string | null
          created_at?: string
          dedup_hash?: string | null
          detected_time?: string
          event_type: string
          exchange: string
          id?: string
          lead_time_minutes?: number | null
          pair?: string | null
          raw_payload?: string | null
          source_url?: string | null
          status?: string
          token_name?: string | null
          token_symbol: string
          updated_at?: string
        }
        Update: {
          announcement_time?: string | null
          chain?: string | null
          confidence_score?: number
          contract_address?: string | null
          created_at?: string
          dedup_hash?: string | null
          detected_time?: string
          event_type?: string
          exchange?: string
          id?: string
          lead_time_minutes?: number | null
          pair?: string | null
          raw_payload?: string | null
          source_url?: string | null
          status?: string
          token_name?: string | null
          token_symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      listing_sources: {
        Row: {
          base_url: string | null
          created_at: string
          enabled: boolean
          id: string
          name: string
          priority: number
          type: string
        }
        Insert: {
          base_url?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          priority?: number
          type: string
        }
        Update: {
          base_url?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          priority?: number
          type?: string
        }
        Relationships: []
      }
      lots: {
        Row: {
          acquired_at: string
          asset_id: string
          created_at: string
          id: string
          qty: number
          remaining_qty: number
          status: string
          transaction_id: string
          unit_cost: number
          user_id: string
        }
        Insert: {
          acquired_at: string
          asset_id: string
          created_at?: string
          id?: string
          qty?: number
          remaining_qty?: number
          status?: string
          transaction_id: string
          unit_cost?: number
          user_id: string
        }
        Update: {
          acquired_at?: string
          asset_id?: string
          created_at?: string
          id?: string
          qty?: number
          remaining_qty?: number
          status?: string
          transaction_id?: string
          unit_cost?: number
          user_id?: string
        }
        Relationships: []
      }
      portfolio_snapshots: {
        Row: {
          created_at: string
          date: string
          id: string
          realized_pnl: number
          total_cost_basis: number
          total_market_value: number
          unrealized_pnl: number
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          realized_pnl?: number
          total_cost_basis?: number
          total_market_value?: number
          unrealized_pnl?: number
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          realized_pnl?: number
          total_cost_basis?: number
          total_market_value?: number
          unrealized_pnl?: number
          user_id?: string
        }
        Relationships: []
      }
      position_snapshots: {
        Row: {
          asset_id: string
          avg_cost: number
          cost_basis: number
          created_at: string
          id: string
          market_price: number
          market_value: number
          portfolio_snapshot_id: string
          qty: number
        }
        Insert: {
          asset_id: string
          avg_cost?: number
          cost_basis?: number
          created_at?: string
          id?: string
          market_price?: number
          market_value?: number
          portfolio_snapshot_id: string
          qty?: number
        }
        Update: {
          asset_id?: string
          avg_cost?: number
          cost_basis?: number
          created_at?: string
          id?: string
          market_price?: number
          market_value?: number
          portfolio_snapshot_id?: string
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "position_snapshots_portfolio_snapshot_id_fkey"
            columns: ["portfolio_snapshot_id"]
            isOneToOne: false
            referencedRelation: "portfolio_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      price_cache: {
        Row: {
          asset_id: string
          market_cap: number | null
          price: number
          price_change_1h: number | null
          price_change_24h: number | null
          price_change_7d: number | null
          source: string | null
          timestamp: string | null
          volume_24h: number | null
        }
        Insert: {
          asset_id: string
          market_cap?: number | null
          price: number
          price_change_1h?: number | null
          price_change_24h?: number | null
          price_change_7d?: number | null
          source?: string | null
          timestamp?: string | null
          volume_24h?: number | null
        }
        Update: {
          asset_id?: string
          market_cap?: number | null
          price?: number
          price_change_1h?: number | null
          price_change_24h?: number | null
          price_change_7d?: number | null
          source?: string | null
          timestamp?: string | null
          volume_24h?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_cache_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history: {
        Row: {
          asset_id: string
          close_price: number
          created_at: string
          date: string
          id: string
          source: string
        }
        Insert: {
          asset_id: string
          close_price: number
          created_at?: string
          date: string
          id?: string
          source?: string
        }
        Update: {
          asset_id?: string
          close_price?: number
          created_at?: string
          date?: string
          id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_signal_aggregate: {
        Row: {
          id: string
          last_updated: string
          risk_level: string
          risk_score: number
          signal_count: number
          signals: Json
          token_symbol: string
        }
        Insert: {
          id?: string
          last_updated?: string
          risk_level?: string
          risk_score?: number
          signal_count?: number
          signals?: Json
          token_symbol: string
        }
        Update: {
          id?: string
          last_updated?: string
          risk_level?: string
          risk_score?: number
          signal_count?: number
          signals?: Json
          token_symbol?: string
        }
        Relationships: []
      }
      sentiment_cache: {
        Row: {
          id: string
          key: string
          payload: Json
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          payload?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      sentiment_history: {
        Row: {
          created_at: string
          id: string
          mention_count: number
          sentiment_score: number
          snapshot_date: string
          source: string
          token_symbol: string
        }
        Insert: {
          created_at?: string
          id?: string
          mention_count?: number
          sentiment_score?: number
          snapshot_date?: string
          source?: string
          token_symbol: string
        }
        Update: {
          created_at?: string
          id?: string
          mention_count?: number
          sentiment_score?: number
          snapshot_date?: string
          source?: string
          token_symbol?: string
        }
        Relationships: []
      }
      source_reliability: {
        Row: {
          false_signal_count: number
          historical_accuracy: number
          id: string
          last_updated: string
          latency_score: number
          source_name: string
          source_type: string
          total_signal_count: number
          trust_score: number
          verification_method: string | null
        }
        Insert: {
          false_signal_count?: number
          historical_accuracy?: number
          id?: string
          last_updated?: string
          latency_score?: number
          source_name: string
          source_type?: string
          total_signal_count?: number
          trust_score?: number
          verification_method?: string | null
        }
        Update: {
          false_signal_count?: number
          historical_accuracy?: number
          id?: string
          last_updated?: string
          latency_score?: number
          source_name?: string
          source_type?: string
          total_signal_count?: number
          trust_score?: number
          verification_method?: string | null
        }
        Relationships: []
      }
      token_risk_flags: {
        Row: {
          created_at: string
          description: string | null
          flag_type: string
          id: string
          severity: number
          token_symbol: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          flag_type: string
          id?: string
          severity?: number
          token_symbol: string
        }
        Update: {
          created_at?: string
          description?: string | null
          flag_type?: string
          id?: string
          severity?: number
          token_symbol?: string
        }
        Relationships: []
      }
      tracking_preferences: {
        Row: {
          asset_id: string | null
          id: string
          tracking_mode: string
          user_id: string
        }
        Insert: {
          asset_id?: string | null
          id?: string
          tracking_mode?: string
          user_id: string
        }
        Update: {
          asset_id?: string | null
          id?: string
          tracking_mode?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_preferences_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          asset_id: string
          created_at: string | null
          external_id: string | null
          fee_amount: number
          fee_currency: string | null
          fingerprint_hash: string | null
          id: string
          note: string | null
          qty: number
          source: string | null
          tags: string[] | null
          timestamp: string
          type: string
          unit_price: number
          updated_at: string | null
          user_id: string
          venue: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          external_id?: string | null
          fee_amount?: number
          fee_currency?: string | null
          fingerprint_hash?: string | null
          id?: string
          note?: string | null
          qty: number
          source?: string | null
          tags?: string[] | null
          timestamp: string
          type: string
          unit_price?: number
          updated_at?: string | null
          user_id: string
          venue?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          external_id?: string | null
          fee_amount?: number
          fee_currency?: string | null
          fingerprint_hash?: string | null
          id?: string
          note?: string | null
          qty?: number
          source?: string | null
          tags?: string[] | null
          timestamp?: string
          type?: string
          unit_price?: number
          updated_at?: string | null
          user_id?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_airdrop_progress: {
        Row: {
          completed: boolean
          completed_at: string | null
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_airdrop_progress_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "airdrop_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          id: string
          key: string
          user_id: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          user_id: string
          value: string
        }
        Update: {
          id?: string
          key?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whale_cache: {
        Row: {
          amount: number
          amount_usd: number
          blockchain: string
          created_at: string
          detected_at: string
          from_address: string
          id: string
          symbol: string
          to_address: string
          transaction_type: string
          tx_hash: string | null
        }
        Insert: {
          amount?: number
          amount_usd?: number
          blockchain: string
          created_at?: string
          detected_at?: string
          from_address?: string
          id?: string
          symbol: string
          to_address?: string
          transaction_type?: string
          tx_hash?: string | null
        }
        Update: {
          amount?: number
          amount_usd?: number
          blockchain?: string
          created_at?: string
          detected_at?: string
          from_address?: string
          id?: string
          symbol?: string
          to_address?: string
          transaction_type?: string
          tx_hash?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
