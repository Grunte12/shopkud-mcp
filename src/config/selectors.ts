/**
 * Shopee Affiliate selectors and endpoints configuration
 * 
 * Isolated in one file so real smoke tests only need selector tweaks.
 * All selectors and endpoints are based on affiliate.shopee.co.th as of 2026.
 */

export interface SelectorConfig {
  // Custom Link Page (ลิงก์ที่กำหนดเอง)
  customLink: {
    page: string;
    productUrlInput: string;
    subId1Input: string;
    subId2Input: string;
    subId3Input: string;
    subId4Input: string;
    subId5Input: string;
    submitButton: string;
    resultDialog: string;
    resultLinkTextarea: string;
    errorMessage: string;
  };

  // Product Offer Detail Page
  offerDetail: {
    pagePattern: RegExp;
    getLinkButton: string;
    linkDialog: string;
    linkDialogHeader: string;
    linkTextarea: string;
    productName: string;
    price: string;
    commissionTable: string;
  };

  // Reports Page
  reports: {
    page: string;
    dateRangeStart: string;
    dateRangeEnd: string;
    downloadButton: string;
    reportTable: string;
  };

  // Common
  captcha: string[];
  loginRequired: string[];
}

export const SHOPEE_SELECTORS: SelectorConfig = {
  customLink: {
    page: 'https://affiliate.shopee.co.th/offer/custom_link',
    productUrlInput: 'textarea[placeholder*="shopee.co.th"], input[placeholder*="URL"], input[name="productUrl"], #product-url',
    subId1Input: '#customLink_sub_id1, input[name="subId1"], #sub-id-1',
    subId2Input: '#customLink_sub_id2, input[name="subId2"], #sub-id-2',
    subId3Input: '#customLink_sub_id3, input[name="subId3"], #sub-id-3',
    subId4Input: '#customLink_sub_id4, input[name="subId4"], #sub-id-4',
    subId5Input: '#customLink_sub_id5, input[name="subId5"], #sub-id-5',
    submitButton: 'button:has-text("เอา ลิงก์"), button:has-text("สร้างลิงก์"), button:has-text("Create Link"), button[type="submit"]',
    resultDialog: '[role="dialog"]:has-text("ลิงก์"), [role="dialog"]:has-text("Link"), .link-result-dialog',
    resultLinkTextarea: 'textarea[readonly], input[readonly][type="text"]',
    errorMessage: '.error-message, [class*="error"], [class*="Error"]',
  },

  offerDetail: {
    pagePattern: /^\/offer\/product_offer\/[1-9][0-9]{0,19}\/?$/,
    getLinkButton: 'button:has-text("เอา ลิงก์"), button:has-text("รับลิงก์"), button:has-text("Get Link")',
    linkDialog: '[role="dialog"]:has-text("ลิงก์ข้อเสนอสินค้า")',
    linkDialogHeader: 'h4:has-text("ลิงก์ข้อเสนอสินค้า")',
    linkTextarea: 'textarea[disabled], input[disabled][type="text"]',
    productName: '.detail-info .name-wrap .name',
    price: '.detail-info .price',
    commissionTable: 'table:has(th:has-text("ประเภทช่องทาง"))',
  },

  reports: {
    page: 'https://affiliate.shopee.co.th/report/conversion_report',
    dateRangeStart: 'input[placeholder="วันเริ่มต้น"], input[type="date"][name="start"], #date-start',
    dateRangeEnd: 'input[placeholder="วันสิ้นสุด"], input[type="date"][name="end"], #date-end',
    downloadButton: 'button:has-text("ดาวน์โหลดรายงาน"), button:has-text("ดาวน์โหลด"), button:has-text("Download")',
    reportTable: 'table',
  },

  captcha: [
    'iframe[src*="captcha"]',
    '.captcha',
    '#captcha',
    '[data-testid="captcha"]',
    '[class*="Captcha"]',
  ],

  loginRequired: [
    'input[type="password"]',
    'input[name="loginKey"]',
    'button:has-text("เข้าสู่ระบบ")',
    'button:has-text("Login")',
    '.login-form',
    '[data-testid="login"]',
  ],
};

export interface EndpointConfig {
  customLinkApi?: string;
  offerDetailApi?: string;
  reportsApi?: string;
}

/**
 * Known API endpoints that may be captured from network traffic
 * These are network-capture targets, not direct API calls
 */
/**
 * Paths seen on a logged-in affiliate session. The custom-link create call
 * is still unknown because dry-run stops before submit.
 */
export const SHOPEE_ENDPOINTS: EndpointConfig = {
  customLinkApi: undefined,
  offerDetailApi: '/api/v3/offer/product',
  reportsApi: '/api/v3/gql',
};

export const OBSERVED_AUTHENTICATED_ENDPOINTS = [
  'GET /api/v3/offer/product',
  'GET /api/v3/user/profile',
  'GET /api/v3/user/status',
  'GET /api/v3/user/check_program_permission',
  'GET /api/v3/offer/checkInAmsWhiteList',
  'GET /api/v3/goods/categoryList',
  'POST /api/v3/gql',
];

export const OBSERVED_LOGGED_OUT_ENDPOINTS = [
  'GET /api/v3/config/website',
  'GET /api/v3/user/profile',
  'GET /api/v3/user/status',
  'GET /api/v3/not_login/config/website',
  'POST /api/v3/gql',
  'POST /api/v2/authentication/get_active_login_page',
];

/**
 * Timeout configurations (in milliseconds)
 */
export const TIMEOUTS = {
  navigation: 30000,
  networkIdle: 5000,
  elementVisible: 5000,
  dialogOpen: 10000,
  formSubmit: 15000,
  captchaCheck: 2000,
};

/**
 * Human-paced delays (in milliseconds)
 */
export const DELAYS = {
  betweenFields: () => 800 + Math.random() * 400, // 800-1200ms
  beforeSubmit: () => 1500 + Math.random() * 1000, // 1.5-2.5s
  afterSubmit: () => 2000 + Math.random() * 1000, // 2-3s
  betweenBatch: () => 3000 + Math.random() * 2000, // 3-5s
};

/**
 * Short link validation pattern
 */
export const SHORT_LINK_PATTERN = /^https:\/\/s\.shopee\.co\.th\/[A-Za-z0-9]+$/;

/**
 * Check if URL is a valid short link
 */
export function isShortLink(url: string): boolean {
  return SHORT_LINK_PATTERN.test(url);
}

export interface ParsedProductUrl {
  shopId: string;
  itemId: string;
}

/**
 * Accept both public product URL shapes:
 * - https://shopee.co.th/slug-i.{shop}.{item}
 * - https://shopee.co.th/product/{shop}/{item}
 */
export function parseProductUrl(url: string): ParsedProductUrl | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'shopee.co.th') return null;
    const slug = u.pathname.match(/-i\.(\d+)\.(\d+)(?:\/|$)/);
    if (slug) return { shopId: slug[1], itemId: slug[2] };
    const product = u.pathname.match(/^\/product\/(\d+)\/(\d+)(?:\/|$)/);
    if (product) return { shopId: product[1], itemId: product[2] };
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate product URL format
 */
export function isValidProductUrl(url: string): boolean {
  return parseProductUrl(url) !== null;
}
