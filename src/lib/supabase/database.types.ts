export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      activity: {
        Row: {
          created_at: string;
          entry_id: string;
          id: string;
          kind: Database["public"]["Enums"]["activity_kind"];
          movie_id: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          entry_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["activity_kind"];
          movie_id: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          entry_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["activity_kind"];
          movie_id?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "current_entries";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "entries";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "public_current_ratings";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "public_reviews";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
          {
            foreignKeyName: "activity_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
        };
        Insert: {
          blocked_id: string;
          blocker_id?: string;
          created_at?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      entries: {
        Row: {
          created_at: string;
          id: string;
          movie_id: number;
          note: string | null;
          score: number | null;
          spoiler: boolean;
          updated_at: string;
          user_id: string;
          version: number;
          watched: boolean;
          watched_date: string | null;
          watched_timezone: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          movie_id: number;
          note?: string | null;
          score?: number | null;
          spoiler?: boolean;
          updated_at?: string;
          user_id?: string;
          version?: number;
          watched?: boolean;
          watched_date?: string | null;
          watched_timezone?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          movie_id?: number;
          note?: string | null;
          score?: number | null;
          spoiler?: boolean;
          updated_at?: string;
          user_id?: string;
          version?: number;
          watched?: boolean;
          watched_date?: string | null;
          watched_timezone?: string;
        };
        Relationships: [
          {
            foreignKeyName: "entries_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      follows: {
        Row: {
          created_at: string;
          follower_id: string;
          following_id: string;
          status: Database["public"]["Enums"]["follow_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          follower_id: string;
          following_id: string;
          status?: Database["public"]["Enums"]["follow_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          follower_id?: string;
          following_id?: string;
          status?: Database["public"]["Enums"]["follow_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_following_id_fkey";
            columns: ["following_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_following_id_fkey";
            columns: ["following_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      list_items: {
        Row: {
          added_at: string;
          list_id: string;
          movie_id: number;
          position: number | null;
        };
        Insert: {
          added_at?: string;
          list_id: string;
          movie_id: number;
          position?: number | null;
        };
        Update: {
          added_at?: string;
          list_id?: string;
          movie_id?: number;
          position?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "list_items_list_id_fkey";
            columns: ["list_id"];
            isOneToOne: false;
            referencedRelation: "lists";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "list_items_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
        ];
      };
      lists: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          kind: Database["public"]["Enums"]["list_kind"];
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["list_kind"];
          name: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["list_kind"];
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lists_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lists_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      movies: {
        Row: {
          cached_at: string;
          poster: string | null;
          title: string;
          tmdb_id: number;
          year: number | null;
        };
        Insert: {
          cached_at?: string;
          poster?: string | null;
          title: string;
          tmdb_id: number;
          year?: number | null;
        };
        Update: {
          cached_at?: string;
          poster?: string | null;
          title?: string;
          tmdb_id?: number;
          year?: number | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          actor_id: string;
          comment_id: string | null;
          created_at: string;
          entry_id: string | null;
          event_key: string;
          id: string;
          kind: string;
          read_at: string | null;
          recipient_id: string;
        };
        Insert: {
          actor_id: string;
          comment_id?: string | null;
          created_at?: string;
          entry_id?: string | null;
          event_key: string;
          id?: string;
          kind: string;
          read_at?: string | null;
          recipient_id: string;
        };
        Update: {
          actor_id?: string;
          comment_id?: string | null;
          created_at?: string;
          entry_id?: string | null;
          event_key?: string;
          id?: string;
          kind?: string;
          read_at?: string | null;
          recipient_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "review_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "current_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "public_current_ratings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "public_reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          created_at: string;
          details: string | null;
          entry_snapshot: Json | null;
          id: string;
          reason: Database["public"]["Enums"]["report_reason"];
          reporter_id: string | null;
          resolved_at: string | null;
          status: Database["public"]["Enums"]["report_status"];
          target_comment_id: string | null;
          target_entry_id: string | null;
          target_kind: string;
          target_user_id: string | null;
        };
        Insert: {
          created_at?: string;
          details?: string | null;
          entry_snapshot?: Json | null;
          id?: string;
          reason: Database["public"]["Enums"]["report_reason"];
          reporter_id?: string | null;
          resolved_at?: string | null;
          status?: Database["public"]["Enums"]["report_status"];
          target_comment_id?: string | null;
          target_entry_id?: string | null;
          target_kind?: string;
          target_user_id?: string | null;
        };
        Update: {
          created_at?: string;
          details?: string | null;
          entry_snapshot?: Json | null;
          id?: string;
          reason?: Database["public"]["Enums"]["report_reason"];
          reporter_id?: string | null;
          resolved_at?: string | null;
          status?: Database["public"]["Enums"]["report_status"];
          target_comment_id?: string | null;
          target_entry_id?: string | null;
          target_kind?: string;
          target_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_target_comment_id_fkey";
            columns: ["target_comment_id"];
            isOneToOne: false;
            referencedRelation: "review_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_target_entry_id_fkey";
            columns: ["target_entry_id"];
            isOneToOne: false;
            referencedRelation: "current_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_target_entry_id_fkey";
            columns: ["target_entry_id"];
            isOneToOne: false;
            referencedRelation: "entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_target_entry_id_fkey";
            columns: ["target_entry_id"];
            isOneToOne: false;
            referencedRelation: "public_current_ratings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_target_entry_id_fkey";
            columns: ["target_entry_id"];
            isOneToOne: false;
            referencedRelation: "public_reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_target_user_id_fkey";
            columns: ["target_user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_target_user_id_fkey";
            columns: ["target_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      review_comments: {
        Row: {
          body: string | null;
          created_at: string;
          deleted_at: string | null;
          edited_at: string | null;
          entry_id: string;
          id: string;
          parent_id: string | null;
          reply_to_user_id: string | null;
          spoiler: boolean;
          user_id: string | null;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          entry_id: string;
          id?: string;
          parent_id?: string | null;
          reply_to_user_id?: string | null;
          spoiler?: boolean;
          user_id?: string | null;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          entry_id?: string;
          id?: string;
          parent_id?: string | null;
          reply_to_user_id?: string | null;
          spoiler?: boolean;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "review_comments_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "current_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_comments_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_comments_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "public_current_ratings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_comments_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "public_reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "review_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_comments_reply_to_user_id_fkey";
            columns: ["reply_to_user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_comments_reply_to_user_id_fkey";
            columns: ["reply_to_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      review_likes: {
        Row: {
          created_at: string;
          entry_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          entry_id: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          entry_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_likes_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "current_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_likes_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_likes_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "public_current_ratings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_likes_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "public_reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      user_favorite_movies: {
        Row: {
          added_at: string;
          movie_id: number;
          user_id: string;
        };
        Insert: {
          added_at?: string;
          movie_id: number;
          user_id?: string;
        };
        Update: {
          added_at?: string;
          movie_id?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_favorite_movies_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
          {
            foreignKeyName: "user_favorite_movies_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_favorite_movies_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      user_preferences: {
        Row: {
          favorite_genre_ids: number[];
          theme: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          favorite_genre_ids?: number[];
          theme?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          favorite_genre_ids?: number[];
          theme?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_preferences_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          avatar: string | null;
          created_at: string;
          id: string;
          profile: NonNullable<Json>;
          updated_at: string;
          username: string | null;
          visibility: Database["public"]["Enums"]["profile_visibility"];
        };
        Insert: {
          avatar?: string | null;
          created_at?: string;
          id: string;
          profile?: NonNullable<Json>;
          updated_at?: string;
          username?: string | null;
          visibility?: Database["public"]["Enums"]["profile_visibility"];
        };
        Update: {
          avatar?: string | null;
          created_at?: string;
          id?: string;
          profile?: NonNullable<Json>;
          updated_at?: string;
          username?: string | null;
          visibility?: Database["public"]["Enums"]["profile_visibility"];
        };
        Relationships: [];
      };
    };
    Views: {
      activity_feed: {
        Row: {
          avatar: string | null;
          created_at: string | null;
          entry_id: string | null;
          id: string | null;
          kind: Database["public"]["Enums"]["activity_kind"] | null;
          movie_id: number | null;
          poster: string | null;
          score: number | null;
          summary: string | null;
          title: string | null;
          user_id: string | null;
          username: string | null;
          year: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "current_entries";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "entries";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "public_current_ratings";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "public_reviews";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
          {
            foreignKeyName: "activity_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      current_entries: {
        Row: {
          created_at: string | null;
          id: string | null;
          movie_id: number | null;
          note: string | null;
          score: number | null;
          spoiler: boolean | null;
          updated_at: string | null;
          user_id: string | null;
          version: number | null;
          watched: boolean | null;
          watched_date: string | null;
          watched_timezone: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "entries_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      following_feed: {
        Row: {
          avatar: string | null;
          created_at: string | null;
          entry_id: string | null;
          id: string | null;
          kind: Database["public"]["Enums"]["activity_kind"] | null;
          movie_id: number | null;
          poster: string | null;
          score: number | null;
          summary: string | null;
          title: string | null;
          user_id: string | null;
          username: string | null;
          year: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "current_entries";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "entries";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "public_current_ratings";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_entry_id_user_id_movie_id_fkey";
            columns: ["entry_id", "user_id", "movie_id"];
            isOneToOne: false;
            referencedRelation: "public_reviews";
            referencedColumns: ["id", "user_id", "movie_id"];
          },
          {
            foreignKeyName: "activity_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
          {
            foreignKeyName: "activity_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      public_current_ratings: {
        Row: {
          id: string | null;
          movie_id: number | null;
          score: number | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "entries_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      public_reviews: {
        Row: {
          created_at: string | null;
          id: string | null;
          movie_id: number | null;
          note: string | null;
          score: number | null;
          spoiler: boolean | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string | null;
          movie_id?: number | null;
          note?: string | null;
          score?: number | null;
          spoiler?: boolean | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string | null;
          movie_id?: number | null;
          note?: string | null;
          score?: number | null;
          spoiler?: boolean | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "entries_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      user_identities: {
        Row: {
          avatar: string | null;
          id: string | null;
          username: string | null;
        };
        Insert: {
          avatar?: string | null;
          id?: string | null;
          username?: string | null;
        };
        Update: {
          avatar?: string | null;
          id?: string | null;
          username?: string | null;
        };
        Relationships: [];
      };
      user_movie_collection: {
        Row: {
          current_score: number | null;
          last_watched_date: string | null;
          movie_id: number | null;
          poster: string | null;
          title: string | null;
          user_id: string | null;
          watch_count: number | null;
          year: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "entries_movie_id_fkey";
            columns: ["movie_id"];
            isOneToOne: false;
            referencedRelation: "movies";
            referencedColumns: ["tmdb_id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_identities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      add_review_comment: {
        Args: {
          comment_text: string;
          is_spoiler?: boolean;
          reply_to?: string;
          target: string;
        };
        Returns: string;
      };
      admin_moderate: {
        Args: {
          action: string;
          reason: string;
          report?: string;
          target_comment?: string;
          target_entry?: string;
          target_user?: string;
        };
        Returns: string;
      };
      admin_moderation_log: {
        Args: { max_rows?: number };
        Returns: {
          action: string;
          admin_username: string;
          created_at: string;
          id: string;
          reason: string;
          report_id: string;
          target_comment_id: string;
          target_entry_id: string;
          target_user_id: string;
          target_username: string;
        }[];
      };
      admin_reports: {
        Args: {
          filter_status?: Database["public"]["Enums"]["report_status"];
          max_rows?: number;
        };
        Returns: {
          comment_body: string;
          comment_deleted: boolean;
          comment_hidden: boolean;
          comment_review_id: string;
          comment_spoiler: boolean;
          created_at: string;
          details: string;
          entry_deleted: boolean;
          entry_hidden: boolean;
          entry_note: string;
          entry_score: number;
          entry_spoiler: boolean;
          id: string;
          movie_id: number;
          movie_title: string;
          reason: Database["public"]["Enums"]["report_reason"];
          reporter_username: string;
          resolved_at: string;
          status: Database["public"]["Enums"]["report_status"];
          target_comment_id: string;
          target_entry_id: string;
          target_kind: string;
          target_suspended: boolean;
          target_user_id: string;
          target_username: string;
        }[];
      };
      consume_movie_request_limit: {
        Args: { key_hash: string; request_scope: string };
        Returns: Json;
      };
      delete_review_comment: { Args: { target: string }; Returns: undefined };
      edit_review_comment: {
        Args: { comment_text: string; is_spoiler: boolean; target: string };
        Returns: undefined;
      };
      find_people: {
        Args: { max_rows?: number; search?: string };
        Returns: {
          avatar: string;
          display_name: string;
          follow_status: Database["public"]["Enums"]["follow_status"];
          id: string;
          last_active: string;
          username: string;
          visibility: Database["public"]["Enums"]["profile_visibility"];
        }[];
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      mark_notifications_read: { Args: { ids?: string[] }; Returns: number };
      movie_rating_summary: {
        Args: { target_movie_id: number };
        Returns: {
          average: number;
          raters: number;
        }[];
      };
      my_account_suspended: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      my_blocked_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          avatar: string;
          blocked_at: string;
          id: string;
          username: string;
        }[];
      };
      my_notifications: {
        Args: { after_at?: string; after_id?: string; page_size?: number };
        Returns: {
          actor_avatar: string;
          actor_username: string;
          available: boolean;
          created_at: string;
          id: string;
          is_read: boolean;
          kind: string;
          movie_title: string;
        }[];
      };
      my_unread_notification_count: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      open_notification: {
        Args: { target: string };
        Returns: {
          actor_username: string;
          available: boolean;
          comment_id: string;
          entry_id: string;
          kind: string;
        }[];
      };
      pending_account_deletions: {
        Args: { max_rows?: number };
        Returns: {
          attempts: number;
          user_id: string;
        }[];
      };
      profile_card: {
        Args: { target_username: string };
        Returns: {
          avatar: string;
          can_view: boolean;
          follow_status: Database["public"]["Enums"]["follow_status"];
          id: string;
          relationship: string;
          username: string;
          visibility: Database["public"]["Enums"]["profile_visibility"];
        }[];
      };
      record_account_deletion_attempt: {
        Args: { failure?: string; target: string };
        Returns: undefined;
      };
      remove_follow: {
        Args: { direction?: string; other_id: string };
        Returns: undefined;
      };
      request_account_deletion: {
        Args: { confirmation: string };
        Returns: undefined;
      };
      request_follow: {
        Args: { target_id: string };
        Returns: Database["public"]["Enums"]["follow_status"];
      };
      respond_follow: {
        Args: { approve: boolean; requester_id: string };
        Returns: undefined;
      };
      review_details: {
        Args: { target: string };
        Returns: {
          avatar: string;
          comment_count: number;
          created_at: string;
          id: string;
          is_hidden: boolean;
          like_count: number;
          liked: boolean;
          movie_id: number;
          note: string;
          poster: string;
          score: number;
          spoiler: boolean;
          title: string;
          updated_at: string;
          user_id: string;
          username: string;
          year: number;
        }[];
      };
      review_replies: {
        Args: {
          after_at?: string;
          after_id?: string;
          page_size?: number;
          thread: string;
        };
        Returns: {
          author_avatar: string;
          author_username: string;
          body: string;
          created_at: string;
          edited_at: string;
          id: string;
          is_mine: boolean;
          parent_id: string;
          reply_count: number;
          reply_to_username: string;
          spoiler: boolean;
          state: string;
        }[];
      };
      review_threads: {
        Args: {
          after_at?: string;
          after_id?: string;
          page_size?: number;
          reply_limit?: number;
          target: string;
        };
        Returns: {
          author_avatar: string;
          author_username: string;
          body: string;
          created_at: string;
          edited_at: string;
          id: string;
          is_mine: boolean;
          parent_id: string;
          reply_count: number;
          reply_to_username: string;
          spoiler: boolean;
          state: string;
        }[];
      };
      set_favorite_movies: {
        Args: { movie_ids: number[] };
        Returns: undefined;
      };
      set_review_like: {
        Args: { should_like: boolean; target: string };
        Returns: {
          is_liked: boolean;
          like_count: number;
        }[];
      };
      username_status: { Args: { candidate: string }; Returns: string };
    };
    Enums: {
      activity_kind: "rated" | "reviewed" | "watched";
      follow_status: "pending" | "accepted" | "declined";
      list_kind: "watchlist" | "custom";
      profile_visibility: "public" | "followers" | "friends" | "private";
      report_reason:
        "spam" | "harassment" | "inappropriate" | "spoilers" | "other";
      report_status: "open" | "resolved" | "dismissed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_kind: ["rated", "reviewed", "watched"],
      follow_status: ["pending", "accepted", "declined"],
      list_kind: ["watchlist", "custom"],
      profile_visibility: ["public", "followers", "friends", "private"],
      report_reason: [
        "spam",
        "harassment",
        "inappropriate",
        "spoilers",
        "other",
      ],
      report_status: ["open", "resolved", "dismissed"],
    },
  },
} as const;
