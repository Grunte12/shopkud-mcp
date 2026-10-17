/**
 * Affiliate paths seen on the logged-in Chrome during read-only checks.
 * Tools must not guess unseen URLs and must not submit public-state changes.
 */
export const OFFER_LIST_PATH = '/api/v3/offer/product/list';
export const EARNINGS_LIVE = 'page_seen';
export const MISSIONS_LIVE = 'nav_seen_captcha_stop';

export const LIVE_PAGES = {
  home: 'https://affiliate.shopee.co.th/',
  dashboard: 'https://affiliate.shopee.co.th/dashboard',
  custom_link: '/offer/custom_link',
  offer: '/offer/product_offer/{itemId}',
  offer_catalog: '/offer/product_offer',
  conversion_report: '/report/conversion_report',
  report_list: '/api/v3/report/list',
  offer_product: '/api/v3/offer/product',
  search: OFFER_LIST_PATH,
  earnings: '/payment/billing',
  earnings_payout: '/payment/payout_record',
  earnings_list: '/api/v3/payment/billing_list',
  missions: '/campaign/campaign_list',
  video: null as string | null,
};

export const LIVE_SEARCH_NOTE = 'GET /api/v3/offer/product/list was seen on /offer/product_offer. Its query keys were list_type, sort_type, page_offset, page_limit, client_type, and filter_types, with no keyword key. Shop and campaign list URLs did include keyword. Response fields were not captured, so search and replacement stay on local snapshots.';

export const EARNINGS_NOTE = 'Read-only pages /payment/billing and /payment/payout_record loaded. GET /api/v3/payment/billing_list includes pending_payout_amount and income_breakdown. This tool does not call that endpoint and does not store payout amounts.';

export const MISSIONS_NOTE = 'The affiliate nav includes /campaign/campaign_list. The read-only check stopped on a CAPTCHA check on that page, so campaign APIs were not captured. Enroll never submits to Shopee.';

export const VIDEO_CREATOR_NOTE = 'Affiliate nav on the dashboard, billing, and payout pages had no video or creator path. Billing income_breakdown includes a shopee_video channel key, which is not a creator page. list_video_clips and prepare_cart_swap stay on local rows and never submit a cart swap.';
