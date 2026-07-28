/**
 * Database types matching supabase/migrations/*.sql.
 * Regenerate against a live project with:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Platform =
  | "facebook"
  | "instagram"
  | "x"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "pinterest";

export type OrgRole = "owner" | "admin" | "editor" | "viewer";

export type ItemType = "social_post" | "promotion" | "announcement" | "email";

export type ItemStatus =
  | "draft"
  | "in_review"
  | "scheduled"
  | "publishing"
  | "published"
  | "partially_published"
  | "failed"
  | "archived";

export type TargetStatus =
  | "pending"
  | "queued"
  | "publishing"
  | "published"
  | "failed"
  | "skipped";

export type MentionKind = "mention" | "comment" | "keyword_match" | "review";
export type Sentiment = "positive" | "neutral" | "negative";

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};
type Row<R, Rel extends Relationship[] = []> = {
  Row: R;
  Insert: Partial<R>;
  Update: Partial<R>;
  Relationships: Rel;
};
type ViewRow<R> = { Row: R; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      organizations: Row<{
        id: string;
        name: string;
        slug: string;
        timezone: string;
        industry_niche: string[];
        created_at: string;
      }>;
      org_members: Row<{
        org_id: string;
        user_id: string;
        role: OrgRole;
        created_at: string;
      }>;
      profiles: Row<{
        id: string;
        full_name: string | null;
        avatar_url: string | null;
        default_org_id: string | null;
        created_at: string;
      }>;
      social_accounts: Row<{
        id: string;
        org_id: string;
        platform: Platform;
        external_id: string;
        handle: string | null;
        display_name: string | null;
        avatar_url: string | null;
        access_token_enc: string | null;
        refresh_token_enc: string | null;
        token_expires_at: string | null;
        scopes: string[];
        status: "active" | "expired" | "revoked" | "error";
        connected_by: string | null;
        metadata: Json;
        created_at: string;
        updated_at: string;
      }>;
      oauth_states: Row<{
        state: string;
        org_id: string;
        user_id: string;
        platform: string;
        code_verifier: string | null;
        redirect_to: string | null;
        expires_at: string;
      }>;
      campaigns: Row<{
        id: string;
        org_id: string;
        name: string;
        description: string | null;
        objective: "awareness" | "engagement" | "bookings" | "seasonal" | null;
        destination: string | null;
        tour_package: string | null;
        start_date: string | null;
        end_date: string | null;
        budget: number | null;
        status: "draft" | "active" | "paused" | "completed" | "archived";
        created_by: string | null;
        created_at: string;
        updated_at: string;
      }>;
      marketing_items: Row<
        {
          id: string;
          org_id: string;
          campaign_id: string | null;
          type: ItemType;
          title: string;
          body: string;
          media: Json;
          media_insights: Json | null;
          promo: Json | null;
          hashtags: string[];
          destination: string | null;
          status: ItemStatus;
          scheduled_at: string | null;
          timezone: string | null;
          ai_generated: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        },
        [
          {
            foreignKeyName: "marketing_items_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ]
      >;
      post_targets: Row<
        {
          id: string;
          org_id: string;
          item_id: string;
          social_account_id: string;
          platform: Platform;
          variant_body: string | null;
          variant_media: Json | null;
          status: TargetStatus;
          external_post_id: string | null;
          external_url: string | null;
          published_at: string | null;
          error: string | null;
          retry_count: number;
          next_retry_at: string | null;
          created_at: string;
          updated_at: string;
        },
        [
          {
            foreignKeyName: "post_targets_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "marketing_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_targets_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
        ]
      >;
      media_assets: Row<{
        id: string;
        org_id: string;
        storage_path: string;
        mime_type: string;
        size_bytes: number | null;
        width: number | null;
        height: number | null;
        duration_seconds: number | null;
        alt_text: string | null;
        created_by: string | null;
        created_at: string;
      }>;
      account_metric_snapshots: Row<{
        id: number;
        org_id: string;
        social_account_id: string;
        captured_at: string;
        followers: number | null;
        following: number | null;
        posts_count: number | null;
        impressions: number | null;
        reach: number | null;
        profile_views: number | null;
        engagement_total: number | null;
        raw: Json | null;
      }>;
      post_metric_snapshots: Row<{
        id: number;
        org_id: string;
        post_target_id: string;
        captured_at: string;
        likes: number | null;
        comments: number | null;
        shares: number | null;
        saves: number | null;
        impressions: number | null;
        reach: number | null;
        video_views: number | null;
        engagement_rate: number | null;
        raw: Json | null;
      }>;
      tracked_keywords: Row<{
        id: string;
        org_id: string;
        keyword: string;
        kind: "hashtag" | "keyword" | "destination" | "brand";
        platforms: string[];
        active: boolean;
        created_at: string;
      }>;
      mentions: Row<{
        id: string;
        org_id: string;
        social_account_id: string | null;
        platform: Platform;
        kind: MentionKind;
        keyword_id: string | null;
        external_id: string;
        author_handle: string | null;
        author_name: string | null;
        author_avatar_url: string | null;
        content: string | null;
        external_url: string | null;
        sentiment: Sentiment | null;
        occurred_at: string | null;
        fetched_at: string;
        is_read: boolean;
        replied: boolean;
        raw: Json | null;
      }>;
      competitors: Row<{
        id: string;
        org_id: string;
        name: string;
        notes: string | null;
        niche: string[];
        destinations: string[];
        active: boolean;
        created_at: string;
      }>;
      competitor_accounts: Row<
        {
          id: string;
          org_id: string;
          competitor_id: string;
          platform: Platform;
          handle: string;
          external_id: string | null;
          profile_url: string | null;
          last_polled_at: string | null;
          created_at: string;
        },
        [
          {
            foreignKeyName: "competitor_accounts_competitor_id_fkey";
            columns: ["competitor_id"];
            isOneToOne: false;
            referencedRelation: "competitors";
            referencedColumns: ["id"];
          },
        ]
      >;
      competitor_snapshots: Row<{
        id: number;
        org_id: string;
        competitor_account_id: string;
        captured_at: string;
        followers: number | null;
        following: number | null;
        posts_count: number | null;
        avg_engagement: number | null;
        posting_frequency: number | null;
        source: "api" | "manual";
        raw: Json | null;
      }>;
      competitor_posts: Row<{
        id: string;
        org_id: string;
        competitor_account_id: string;
        external_id: string;
        posted_at: string | null;
        content: string | null;
        media_type:
          | "image"
          | "video"
          | "carousel"
          | "reel"
          | "short"
          | "text"
          | "link"
          | null;
        likes: number | null;
        comments: number | null;
        shares: number | null;
        views: number | null;
        hashtags: string[];
        destinations: string[];
        raw: Json | null;
        fetched_at: string;
      }>;
      ai_strategies: Row<{
        id: string;
        org_id: string;
        kind:
          | "gap_analysis"
          | "content_plan"
          | "posting_schedule"
          | "competitor_report";
        title: string;
        summary: string | null;
        input_snapshot: Json | null;
        model: string | null;
        provider: string | null;
        status: "pending" | "running" | "completed" | "failed";
        error: string | null;
        created_by: string | null;
        created_at: string;
        completed_at: string | null;
      }>;
      ai_recommendations: Row<
        {
          id: string;
          org_id: string;
          strategy_id: string;
          category:
            | "gap_destination"
            | "gap_content_type"
            | "gap_timing"
            | "gap_audience"
            | "gap_hashtag"
            | "action";
          title: string;
          rationale: string | null;
          priority: number;
          suggested_action: Json | null;
          status: "proposed" | "accepted" | "dismissed" | "done";
          created_item_id: string | null;
          created_at: string;
        },
        [
          {
            foreignKeyName: "ai_recommendations_strategy_id_fkey";
            columns: ["strategy_id"];
            isOneToOne: false;
            referencedRelation: "ai_strategies";
            referencedColumns: ["id"];
          },
        ]
      >;
      job_runs: Row<{
        id: number;
        job: string;
        started_at: string;
        finished_at: string | null;
        ok: boolean | null;
        items_processed: number;
        error: string | null;
      }>;
      ai_usage: Row<{
        org_id: string;
        day: string;
        calls: number;
      }>;
    };
    Views: {
      v_follower_growth: ViewRow<{
        org_id: string;
        social_account_id: string;
        day: string;
        followers: number | null;
        engagement_total: number | null;
      }>;
      v_engagement_by_hour: ViewRow<{
        org_id: string;
        platform: Platform;
        dow: number;
        hour: number;
        posts: number;
        avg_engagement_rate: number | null;
        total_engagement: number | null;
      }>;
      v_account_latest_metrics: ViewRow<{
        org_id: string;
        social_account_id: string;
        captured_at: string;
        followers: number | null;
        following: number | null;
        posts_count: number | null;
        impressions: number | null;
        reach: number | null;
        engagement_total: number | null;
      }>;
      v_competitor_latest: ViewRow<{
        org_id: string;
        competitor_account_id: string;
        captured_at: string;
        followers: number | null;
        posts_count: number | null;
        avg_engagement: number | null;
        posting_frequency: number | null;
      }>;
    };
    Functions: {
      is_org_member: { Args: { p_org: string }; Returns: boolean };
      has_org_role: { Args: { p_org: string; p_roles: string[] }; Returns: boolean };
      increment_ai_usage: { Args: { p_org: string }; Returns: number };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Convenience row aliases
export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type SocialAccount = Database["public"]["Tables"]["social_accounts"]["Row"];
export type Campaign = Database["public"]["Tables"]["campaigns"]["Row"];
export type MarketingItem = Database["public"]["Tables"]["marketing_items"]["Row"];
export type PostTarget = Database["public"]["Tables"]["post_targets"]["Row"];
export type Mention = Database["public"]["Tables"]["mentions"]["Row"];
export type TrackedKeyword = Database["public"]["Tables"]["tracked_keywords"]["Row"];
export type Competitor = Database["public"]["Tables"]["competitors"]["Row"];
export type CompetitorAccount = Database["public"]["Tables"]["competitor_accounts"]["Row"];
export type CompetitorPost = Database["public"]["Tables"]["competitor_posts"]["Row"];
export type AiStrategy = Database["public"]["Tables"]["ai_strategies"]["Row"];
export type AiRecommendation = Database["public"]["Tables"]["ai_recommendations"]["Row"];
