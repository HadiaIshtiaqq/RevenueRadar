export interface Alert {
  id: string;
  name: string;
  targetEntity: string;
  entityAbbreviation: string;
  signalTypes: string[];
  channels: ('mail' | 'chat' | 'webhook' | 'sms')[];
  status: boolean;
  lastTrigger: string;
  totalEvents?: number;
  impactScore?: number;
}

export interface Competitor {
  id: string;
  name: string;
  threatLevel: number; // 0-100 or 0-10
  website: string;
  description: string;
  hqLocation: string;
  signalChanges: number;
  hiresCount: number;
  shareOfVoice: number[]; // 10 data points for 30/90 days
  sentiment: 'Outperforming' | 'Neutral/Stable' | 'Competitor Threat' | 'Limited Data';
}

export interface TimelineEvent {
  id: string;
  type: 'pricing' | 'messaging' | 'hiring' | 'product';
  title: string;
  time: string;
  description: string;
  tag?: string;
  previousValue?: string;
  newValue?: string;
  addedText?: string;
  removedText?: string;
  extraDetails?: string;
}

export interface Firmographics {
  fundingTotal: string;
  fundingStage: string;
  revenueRange: string;
  revenueDetails: string;
  employees: string;
  growthYoY: string;
  industry: string;
  industryDetails: string;
}

export interface Persona {
  name: string;
  title: string;
  avatarUrl?: string;
  initials?: string;
}

export interface CompanyEnrichment {
  name: string;
  domain: string;
  intentScore: number;
  isPublicTarget: boolean;
  hqLocation: string;
  firmographics: Firmographics;
  technographics: string[];
  timeline: TimelineEvent[];
  aiSynthesis: {
    recommendedAngle: string;
    outreachMessage: string;
    personas: Persona[];
    marketMaturity: number; // 0-100
    marketContext: string;
  };
}

export interface BattlecardResource {
  title: string;
  category: string;
  content: string;
}

export interface CompetitorBattlecard {
  competitorName: string;
  threatLevel: number;
  marketOverlap: number;
  featureParity: number;
  timeline: TimelineEvent[];
  strategicSummary: {
    weaknesses: string[];
    strengths: string[];
  };
  battlecards: BattlecardResource[];
  _offlineMode?: boolean;
}

export type ViewType = 'dashboard' | 'competitors' | 'accounts' | 'alerts' | 'research' | 'settings';
