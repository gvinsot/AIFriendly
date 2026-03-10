export type ImprovementSeverity = "critical" | "warning" | "info";

export interface Improvement {
  id: string;
  title: string;
  description: string;
  severity: ImprovementSeverity;
  category: string;
  suggestion?: string;
}

export interface RobotsAnalysis {
  exists: boolean;
  blocksAI: string[];
  allowsAI: string[];
  hasSitemapReference: boolean;
}

export interface SitemapAnalysis {
  exists: boolean;
  url: string | null;
}

export interface LlmsTxtAnalysis {
  exists: boolean;
  content: string | null;
}

export interface MetaRobotsInfo {
  noindex: boolean;
  nofollow: boolean;
  nosnippet: boolean;
  noai: boolean;
}

export interface BotAccessInfo {
  robotsTxt: RobotsAnalysis;
  sitemap: SitemapAnalysis;
  llmsTxt: LlmsTxtAnalysis;
  metaRobots: MetaRobotsInfo;
}

export interface SemanticHtmlInfo {
  hasNav: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
  hasMain: boolean;
  hasArticle: boolean;
  hasSection: boolean;
  hasAside: boolean;
}

export interface AIPreviewContent {
  url: string;
  title: string | null;
  meta: {
    description: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    ogType: string | null;
    canonical: string | null;
    twitterCard: string | null;
  };
  headings: { level: number; text: string }[];
  mainContent: string;
  images: { src: string; alt: string | null }[];
  links: { href: string; text: string }[];
  structuredData: boolean;
  semanticHtml: SemanticHtmlInfo;
  lang: string | null;
  botAccess: BotAccessInfo;
}

export interface AnalysisResult {
  url: string;
  score: number;
  maxScore: number;
  improvements: Improvement[];
  aiPreview: AIPreviewContent;
  aiPreviewYaml: string;
  botAccess: BotAccessInfo;
  analyzedAt: string;
}
