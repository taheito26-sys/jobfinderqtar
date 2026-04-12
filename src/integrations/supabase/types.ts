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
      activity_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      application_drafts: {
        Row: {
          additional_fields: Json | null
          apply_mode: string
          approved_at: string | null
          blockers: Json | null
          created_at: string
          id: string
          job_id: string
          match_id: string | null
          notes: string | null
          status: string | null
          tailored_cover_letter_id: string | null
          tailored_cv_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          additional_fields?: Json | null
          apply_mode?: string
          approved_at?: string | null
          blockers?: Json | null
          created_at?: string
          id?: string
          job_id: string
          match_id?: string | null
          notes?: string | null
          status?: string | null
          tailored_cover_letter_id?: string | null
          tailored_cv_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          additional_fields?: Json | null
          apply_mode?: string
          approved_at?: string | null
          blockers?: Json | null
          created_at?: string
          id?: string
          job_id?: string
          match_id?: string | null
          notes?: string | null
          status?: string | null
          tailored_cover_letter_id?: string | null
          tailored_cv_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_drafts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_drafts_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "job_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_drafts_tailored_cover_letter_id_fkey"
            columns: ["tailored_cover_letter_id"]
            isOneToOne: false
            referencedRelation: "tailored_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_drafts_tailored_cv_id_fkey"
            columns: ["tailored_cv_id"]
            isOneToOne: false
            referencedRelation: "tailored_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      application_events: {
        Row: {
          created_at: string
          draft_id: string | null
          event_type: string
          id: string
          job_id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id?: string | null
          event_type: string
          id?: string
          job_id: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string | null
          event_type?: string
          id?: string
          job_id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      application_submissions: {
        Row: {
          created_at: string
          draft_id: string
          follow_up_date: string | null
          id: string
          job_id: string
          outcome_notes: string | null
          response_received_at: string | null
          submission_method: string | null
          submission_status: string | null
          submitted_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          follow_up_date?: string | null
          id?: string
          job_id: string
          outcome_notes?: string | null
          response_received_at?: string | null
          submission_method?: string | null
          submission_status?: string | null
          submitted_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          follow_up_date?: string | null
          id?: string
          job_id?: string
          outcome_notes?: string | null
          response_received_at?: string | null
          submission_method?: string | null
          submission_status?: string | null
          submitted_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_submissions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "application_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_submissions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          created_at: string
          credential_id: string | null
          credential_url: string | null
          expiry_date: string | null
          id: string
          issue_date: string | null
          issuing_organization: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credential_id?: string | null
          credential_url?: string | null
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          issuing_organization: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          credential_id?: string | null
          credential_url?: string | null
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          issuing_organization?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      document_versions: {
        Row: {
          change_notes: string | null
          created_at: string
          document_id: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          parsed_content: Json | null
          user_id: string
          version_number: number
        }
        Insert: {
          change_notes?: string | null
          created_at?: string
          document_id: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          parsed_content?: Json | null
          user_id: string
          version_number?: number
        }
        Update: {
          change_notes?: string | null
          created_at?: string
          document_id?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          parsed_content?: Json | null
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "master_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      education_history: {
        Row: {
          achievements: Json | null
          created_at: string
          degree: string
          end_date: string | null
          field_of_study: string | null
          gpa: string | null
          id: string
          institution: string
          sort_order: number | null
          start_date: string | null
          user_id: string
        }
        Insert: {
          achievements?: Json | null
          created_at?: string
          degree: string
          end_date?: string | null
          field_of_study?: string | null
          gpa?: string | null
          id?: string
          institution: string
          sort_order?: number | null
          start_date?: string | null
          user_id: string
        }
        Update: {
          achievements?: Json | null
          created_at?: string
          degree?: string
          end_date?: string | null
          field_of_study?: string | null
          gpa?: string | null
          id?: string
          institution?: string
          sort_order?: number | null
          start_date?: string | null
          user_id?: string
        }
        Relationships: []
      }
      employment_history: {
        Row: {
          achievements: Json | null
          company: string
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          is_current: boolean | null
          location: string | null
          sort_order: number | null
          start_date: string
          technologies: Json | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          achievements?: Json | null
          company: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean | null
          location?: string | null
          sort_order?: number | null
          start_date: string
          technologies?: Json | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          achievements?: Json | null
          company?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean | null
          location?: string | null
          sort_order?: number | null
          start_date?: string
          technologies?: Json | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      job_embeddings: {
        Row: {
          created_at: string
          embedding: string | null
          id: string
          job_id: string
          model: string | null
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          id?: string
          job_id: string
          model?: string | null
        }
        Update: {
          created_at?: string
          embedding?: string | null
          id?: string
          job_id?: string
          model?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_embeddings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_matches: {
        Row: {
          blockers: Json | null
          compensation_fit_score: number | null
          created_at: string
          hard_requirements_score: number | null
          id: string
          industry_fit_score: number | null
          job_id: string
          language_fit_score: number | null
          location_fit_score: number | null
          match_reasons: Json | null
          missing_requirements: Json | null
          overall_score: number
          recommendation: string | null
          scored_at: string
          semantic_similarity: number | null
          seniority_fit_score: number | null
          skill_overlap_score: number | null
          title_relevance_score: number | null
          user_id: string
          version: number | null
          work_auth_fit_score: number | null
        }
        Insert: {
          blockers?: Json | null
          compensation_fit_score?: number | null
          created_at?: string
          hard_requirements_score?: number | null
          id?: string
          industry_fit_score?: number | null
          job_id: string
          language_fit_score?: number | null
          location_fit_score?: number | null
          match_reasons?: Json | null
          missing_requirements?: Json | null
          overall_score?: number
          recommendation?: string | null
          scored_at?: string
          semantic_similarity?: number | null
          seniority_fit_score?: number | null
          skill_overlap_score?: number | null
          title_relevance_score?: number | null
          user_id: string
          version?: number | null
          work_auth_fit_score?: number | null
        }
        Update: {
          blockers?: Json | null
          compensation_fit_score?: number | null
          created_at?: string
          hard_requirements_score?: number | null
          id?: string
          industry_fit_score?: number | null
          job_id?: string
          language_fit_score?: number | null
          location_fit_score?: number | null
          match_reasons?: Json | null
          missing_requirements?: Json | null
          overall_score?: number
          recommendation?: string | null
          scored_at?: string
          semantic_similarity?: number | null
          seniority_fit_score?: number | null
          skill_overlap_score?: number | null
          title_relevance_score?: number | null
          user_id?: string
          version?: number | null
          work_auth_fit_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_matches_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_sources: {
        Row: {
          config: Json | null
          created_at: string
          enabled: boolean | null
          id: string
          last_synced_at: string | null
          source_name: string
          source_type: string
          supports_auto_submit: boolean | null
          user_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          last_synced_at?: string | null
          source_name: string
          source_type?: string
          supports_auto_submit?: boolean | null
          user_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          last_synced_at?: string | null
          source_name?: string
          source_type?: string
          supports_auto_submit?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
      job_subscriptions: {
        Row: {
          check_interval_hours: number | null
          config: Json | null
          country: string | null
          created_at: string
          enabled: boolean | null
          id: string
          jobs_found_total: number | null
          last_checked_at: string | null
          name: string
          search_query: string | null
          subscription_type: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          check_interval_hours?: number | null
          config?: Json | null
          country?: string | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          jobs_found_total?: number | null
          last_checked_at?: string | null
          name: string
          search_query?: string | null
          subscription_type?: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          check_interval_hours?: number | null
          config?: Json | null
          country?: string | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          jobs_found_total?: number | null
          last_checked_at?: string | null
          name?: string
          search_query?: string | null
          subscription_type?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          apply_url: string | null
          company: string
          created_at: string
          description: string | null
          employment_type: string | null
          expires_at: string | null
          external_id: string | null
          id: string
          industry: string | null
          location: string | null
          nice_to_haves: Json | null
          normalized: boolean | null
          posted_at: string | null
          raw_data: Json | null
          remote_type: string | null
          requirements: Json | null
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          seniority_level: string | null
          source_id: string | null
          source_url: string | null
          status: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          apply_url?: string | null
          company: string
          created_at?: string
          description?: string | null
          employment_type?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          industry?: string | null
          location?: string | null
          nice_to_haves?: Json | null
          normalized?: boolean | null
          posted_at?: string | null
          raw_data?: Json | null
          remote_type?: string | null
          requirements?: Json | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          seniority_level?: string | null
          source_id?: string | null
          source_url?: string | null
          status?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          apply_url?: string | null
          company?: string
          created_at?: string
          description?: string | null
          employment_type?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          industry?: string | null
          location?: string | null
          nice_to_haves?: Json | null
          normalized?: boolean | null
          posted_at?: string | null
          raw_data?: Json | null
          remote_type?: string | null
          requirements?: Json | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          seniority_level?: string | null
          source_id?: string | null
          source_url?: string | null
          status?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          headline: string | null
          id: string
          last_synced_at: string | null
          linkedin_sub: string | null
          profile_url: string | null
          raw_claims: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          last_synced_at?: string | null
          linkedin_sub?: string | null
          profile_url?: string | null
          raw_claims?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          headline?: string | null
          id?: string
          last_synced_at?: string | null
          linkedin_sub?: string | null
          profile_url?: string | null
          raw_claims?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      master_documents: {
        Row: {
          created_at: string
          document_type: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          is_primary: boolean | null
          mime_type: string | null
          parsed_content: Json | null
          title: string
          updated_at: string
          user_id: string
          version: number | null
        }
        Insert: {
          created_at?: string
          document_type: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          is_primary?: boolean | null
          mime_type?: string | null
          parsed_content?: Json | null
          title: string
          updated_at?: string
          user_id: string
          version?: number | null
        }
        Update: {
          created_at?: string
          document_type?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          is_primary?: boolean | null
          mime_type?: string | null
          parsed_content?: Json | null
          title?: string
          updated_at?: string
          user_id?: string
          version?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          entity_id: string | null
          id: string
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          id?: string
          message?: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_embeddings: {
        Row: {
          created_at: string
          embedding: string | null
          id: string
          model: string | null
          section: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          id?: string
          model?: string | null
          section?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          embedding?: string | null
          id?: string
          model?: string | null
          section?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profile_skills: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_primary: boolean | null
          proficiency: string | null
          skill_name: string
          user_id: string
          years_experience: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean | null
          proficiency?: string | null
          skill_name: string
          user_id: string
          years_experience?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean | null
          proficiency?: string | null
          skill_name?: string
          user_id?: string
          years_experience?: number | null
        }
        Relationships: []
      }
      profiles_v2: {
        Row: {
          country: string | null
          created_at: string
          desired_industries: Json | null
          desired_salary_currency: string | null
          desired_salary_max: number | null
          desired_salary_min: number | null
          desired_seniority: string | null
          desired_titles: Json | null
          email: string | null
          full_name: string
          github_url: string | null
          headline: string | null
          id: string
          languages: Json | null
          linkedin_url: string | null
          location: string | null
          phone: string | null
          portfolio_url: string | null
          remote_preference: string | null
          summary: string | null
          updated_at: string
          user_id: string
          visa_status: string | null
          willing_to_relocate: boolean | null
          work_authorization: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          desired_industries?: Json | null
          desired_salary_currency?: string | null
          desired_salary_max?: number | null
          desired_salary_min?: number | null
          desired_seniority?: string | null
          desired_titles?: Json | null
          email?: string | null
          full_name?: string
          github_url?: string | null
          headline?: string | null
          id?: string
          languages?: Json | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          portfolio_url?: string | null
          remote_preference?: string | null
          summary?: string | null
          updated_at?: string
          user_id: string
          visa_status?: string | null
          willing_to_relocate?: boolean | null
          work_authorization?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          desired_industries?: Json | null
          desired_salary_currency?: string | null
          desired_salary_max?: number | null
          desired_salary_min?: number | null
          desired_seniority?: string | null
          desired_titles?: Json | null
          email?: string | null
          full_name?: string
          github_url?: string | null
          headline?: string | null
          id?: string
          languages?: Json | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          portfolio_url?: string | null
          remote_preference?: string | null
          summary?: string | null
          updated_at?: string
          user_id?: string
          visa_status?: string | null
          willing_to_relocate?: boolean | null
          work_authorization?: string | null
        }
        Relationships: []
      }
      proof_points: {
        Row: {
          category: string
          context: string | null
          created_at: string
          employment_id: string | null
          id: string
          metric_value: string | null
          statement: string
          tags: Json | null
          user_id: string
          verified: boolean | null
        }
        Insert: {
          category?: string
          context?: string | null
          created_at?: string
          employment_id?: string | null
          id?: string
          metric_value?: string | null
          statement: string
          tags?: Json | null
          user_id: string
          verified?: boolean | null
        }
        Update: {
          category?: string
          context?: string | null
          created_at?: string
          employment_id?: string | null
          id?: string
          metric_value?: string | null
          statement?: string
          tags?: Json | null
          user_id?: string
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "proof_points_employment_id_fkey"
            columns: ["employment_id"]
            isOneToOne: false
            referencedRelation: "employment_history"
            referencedColumns: ["id"]
          },
        ]
      }
      tailored_documents: {
        Row: {
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          changes_summary: Json | null
          content: Json
          created_at: string
          document_type: string
          file_path: string | null
          id: string
          job_id: string
          master_document_id: string | null
          match_id: string | null
          original_content: Json | null
          unsupported_claims: Json | null
          updated_at: string
          user_id: string
          version: number | null
        }
        Insert: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          changes_summary?: Json | null
          content?: Json
          created_at?: string
          document_type: string
          file_path?: string | null
          id?: string
          job_id: string
          master_document_id?: string | null
          match_id?: string | null
          original_content?: Json | null
          unsupported_claims?: Json | null
          updated_at?: string
          user_id: string
          version?: number | null
        }
        Update: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          changes_summary?: Json | null
          content?: Json
          created_at?: string
          document_type?: string
          file_path?: string | null
          id?: string
          job_id?: string
          master_document_id?: string | null
          match_id?: string | null
          original_content?: Json | null
          unsupported_claims?: Json | null
          updated_at?: string
          user_id?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tailored_documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tailored_documents_master_document_id_fkey"
            columns: ["master_document_id"]
            isOneToOne: false
            referencedRelation: "master_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tailored_documents_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "job_matches"
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {}
    Enums: {}
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
    Enums: {},
  },
} as const
