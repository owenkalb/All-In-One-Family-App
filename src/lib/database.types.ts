// Mirrors supabase/migrations. Regenerate with `npm run db:types` once the
// project is linked; this hand-written copy follows the same shape.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type GroupRole = "admin" | "member" | "child" | "guest";
type MembershipStatus = "pending" | "active";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          calendar_color: string;
          created_at: string;
        };
        Insert: never;
        Update: {
          display_name?: string;
          avatar_url?: string | null;
          calendar_color?: string;
        };
        Relationships: [];
      };
      groups: {
        Row: {
          id: string;
          name: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: { name?: string };
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_members: {
        Row: {
          group_id: string;
          user_id: string;
          role: GroupRole;
          status: MembershipStatus;
          joined_at: string;
        };
        Insert: never;
        Update: { role?: GroupRole; status?: MembershipStatus };
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_invites: {
        Row: {
          id: string;
          group_id: string;
          token: string;
          created_by: string;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          group_id: string;
          created_by: string;
          expires_at?: string;
        };
        Update: { revoked_at?: string | null };
        Relationships: [
          {
            foreignKeyName: "group_invites_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_group: { Args: { group_name: string }; Returns: string };
      join_group_by_invite: { Args: { invite_token: string }; Returns: string };
      preview_invite: {
        Args: { invite_token: string };
        Returns: { group_id: string; group_name: string }[];
      };
      is_group_member: { Args: { gid: string }; Returns: boolean };
      is_group_admin: { Args: { gid: string }; Returns: boolean };
      shares_group_with: { Args: { other: string }; Returns: boolean };
    };
    Enums: {
      group_role: GroupRole;
      membership_status: MembershipStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
