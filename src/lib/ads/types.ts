export class AdsApiError extends Error {
    constructor(
      public platform: string,
      public code: string,
      message: string,
      public retryable = false
    ) {
      super(message);
      this.name = "AdsApiError";
    }
  }
  
  export interface AdCampaignInput {
    name: string;
    objective: string;
    budget: number | null;
    currency: string;
    startDate: string | null;
    endDate: string | null;
    targetingNotes: string | null;
    adAccountId: string;
  }
  
  export interface AdPerformance {
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    conversions: number | null;
  }
  
  export interface AdsProviderAdapter {
    createLiveCampaign(
      input: AdCampaignInput,
      accessToken: string
    ): Promise<{ externalCampaignId: string }>;
    fetchPerformance(externalCampaignId: string, accessToken: string): Promise<AdPerformance>;
    setStatus(
      externalCampaignId: string,
      status: "active" | "paused",
      accessToken: string
    ): Promise<void>;
  }