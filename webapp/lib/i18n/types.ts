export type Locale = "en" | "fr" | "es" | "de";

export const LOCALES: { code: Locale; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
];

export const DEFAULT_LOCALE: Locale = "en";

export interface Dictionary {
  // Common
  common: {
    aiReadabilityScore: string;
    score: string;
    share: string;
    copied: string;
    copy: string;
    back: string;
    cancel: string;
    save: string;
    delete: string;
    edit: string;
    add: string;
    loading: string;
    connectionError: string;
    error: string;
    noData: string;
    analyze: string;
    analyzing: string;
    severity: { critical: string; warning: string; info: string };
    frequency: {
      "6h": string;
      daily: string;
      weekly: string;
      monthly: string;
    };
  };

  // Metadata
  meta: {
    title: string;
    description: string;
    ogAlt: string;
  };

  // Home page
  home: {
    subtitle: string;
    dashboardLink: string;
    // Hero
    heroHeadline: string;
    heroSubheadline: string;
    heroCta: string;
    heroSecondaryCta: string;
    // Analyze form
    urlPlaceholder: string;
    urlLabel: string;
    analyzeButton: string;
    analyzingButton: string;
    emptyUrlError: string;
    analyzeError: string;
    // Results
    resultsHeading: string;
    scoreTitle: string;
    improvementsTitle: string;
    improvementsSubtitle: string;
    aiPreviewTitle: string;
    aiPreviewSubtitle: string;
    // Problem section
    problemTitle: string;
    problemSubtitle: string;
    problemCards: { icon: string; title: string; description: string }[];
    // Features section
    featuresTitle: string;
    featuresSubtitle: string;
    features: { icon: string; title: string; description: string }[];
    // MCP section
    mcpTitle: string;
    mcpSubtitle: string;
    mcpDescription: string;
    mcpFeatures: string[];
    mcpCodeComment: string;
    // How it works
    howTitle: string;
    howSteps: { step: string; title: string; description: string }[];
    // CTA
    ctaTitle: string;
    ctaSubtitle: string;
    ctaButton: string;
    // Footer
    footerTool: string;
    footerSeo: string;
    footerLinks: { label: string; href: string }[];
  };

  // Auth
  auth: {
    signInSubtitle: string;
    oauthError: string;
    genericError: string;
    continueGoogle: string;
    continueMicrosoft: string;
    backToHome: string;
  };

  // Share
  shareSection: {
    shareText: (score: number, url: string) => string;
    shareTitle: string;
    shareOnX: string;
    shareOnLinkedIn: string;
    shareOnFacebook: string;
    shareNative: string;
    copyLink: string;
  };

  // Dashboard
  dashboard: {
    title: string;
    subtitle: string;
    registeredSites: string;
    averageScore: string;
    recentAnalyses: string;
    viewAllSites: string;
    noAnalysesYet: string;
    addSite: string;
    nav: {
      dashboard: string;
      mySites: string;
      apiKeys: string;
    };
    signOut: string;
  };

  // API Keys
  apiKeys: {
    title: string;
    subtitle: string;
    createButton: string;
    createTitle: string;
    namePlaceholder: string;
    keyCreated: string;
    keyWarning: string;
    createError: string;
    confirmDelete: string;
    noKeys: string;
    created: string;
    lastUsed: string;
    mcpTitle: string;
    mcpDescription: string;
  };

  // Sites list
  sites: {
    title: string;
    subtitle: string;
    addSiteButton: string;
    editSite: string;
    addSiteForm: string;
    siteName: string;
    siteNamePlaceholder: string;
    url: string;
    urlPlaceholder: string;
    analysisFrequency: string;
    frequencyOptions: {
      "6h": string;
      daily: string;
      weekly: string;
      monthly: string;
    };
    savingButton: string;
    noSitesYet: string;
    addFirstSite: string;
    inactive: string;
    analysisCount: (n: number) => string;
    history: string;
    confirmDelete: string;
    saveError: string;
  };

  // Site detail
  siteDetail: {
    mySites: string;
    analysisLabel: string;
    siteNotFound: string;
    tabs: {
      ai: string;
      availability: string;
      security: string;
    };
    // AI tab
    ai: {
      title: string;
      analyzeButton: string;
      analyzingButton: string;
      suggestedImprovements: string;
      perfectScore: string;
      aiPreview: string;
      scoreEvolution: string;
      analysisHistory: string;
      analysisHistoryHint: string;
      noAnalysis: string;
    };
    // Availability tab
    availability: {
      title: string;
      checkButton: string;
      checkingButton: string;
      currentScore: string;
      http: string;
      ping: string;
      loadTime: string;
      scoreTrend: string;
      responseTime: string;
      checkHistory: string;
      checkHistoryHint: string;
      noCheck: string;
      noCheckHint: string;
      httpStatus: string;
      ttfb: string;
      size: string;
      ssl: string;
      sslValid: string;
      sslInvalid: string;
      checkDetails: string;
    };
    // Security tab
    security: {
      title: string;
      scanButton: string;
      scanningButton: string;
      global: string;
      headers: string;
      sslTls: string;
      cookies: string;
      infoLeak: string;
      injection: string;
      scoreTrend: string;
      scanHistory: string;
      scanHistoryHint: string;
      noScan: string;
      noScanHint: string;
      recommendations: string;
      catHeaders: string;
      catSsl: string;
      catCookies: string;
      catInfoLeak: string;
      catInjection: string;
    };
  };

  // Subscription
  subscribe: {
    title: string;
    subtitle: string;
    perMonth: string;
    features: string[];
    checkoutButton: string;
    successTitle: string;
    successMessage: string;
    goToDashboard: string;
    manageBilling: string;
    canceledTitle: string;
    canceledMessage: string;
    retryCheckout: string;
  };
}
