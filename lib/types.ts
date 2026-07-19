// Shared contracts for Airadio. Every module codes against these — do not fork shapes locally.

export type TalkSegment = {
  kind: "talk";
  label: "opening" | "transition" | "handoff" | "outro";
  text: string;
  personaId?: string; // set when someone other than the primary host speaks (v4 co-host handoff)
};

export type SongSegment = {
  kind: "song";
  title: string;
  src: string; // e.g. "/music/midnight-signal.mp3"
};

export type Segment = TalkSegment | SongSegment;

export interface Campaign {
  id: string;
  advertiser: string;
  product: string;
  facts: string; // approved claims only — the ONLY source of ad copy
  tags: string[];
  bidCpm: number;
  approved: boolean;
  impressions: number;
  createdAt: string; // ISO
}

export interface Show {
  stationName: string; // e.g. "Nikhil FM"
  tagline: string;
  fingerprint: string[]; // the interest chips this show was built from
  sponsor: Campaign | null;
  segments: Segment[]; // talk/song interleaved, starts with the 60s opening talk
  fallback?: boolean; // true when Gemini was unreachable and the canned script was used
  reactions?: { skip: string[]; love: string[] }; // 4 short in-persona one-liners each
  persona?: { id: string; name: string; voice: string; delivery: string };
  coHost?: { id: string; name: string; voice: string; delivery: string }; // v4: takes the mic at the handoff
}

export interface Stats {
  listeners: number;
  minutesStreamed: number;
  showsGenerated: number;
  adImpressions: number;
  shares: number;
}

export type TrackEvent =
  | "show_generated"
  | "play_start"
  | "minute"
  | "ad_impression"
  | "share";

export interface StoreShape {
  stats: Stats;
  campaigns: Campaign[];
}
