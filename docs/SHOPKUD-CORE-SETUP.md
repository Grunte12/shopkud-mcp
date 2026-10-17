# ShopKud Core Setup Guide

## Overview

ShopKud Core is a CDP-based MCP server that replaces the extension-heavy approach with direct Chrome control via patchright (patched Playwright). It includes:

- Node MCP server with CDP controller
- SQLite registry with 5 Sub ID slots
- Local web console UI
- Comprehensive testing suite

## Prerequisites

- Node.js 20+
- Chrome browser
- macOS, Linux, or Windows

## 1. Install Dependencies

```bash
npm install
```

## 2. Set Up Dedicated Chrome Profile

**Important:** Never use your personal Chrome profile. Create a dedicated profile for ShopKud.

### macOS Setup

Create a dedicated profile directory:

```bash
mkdir -p ~/shopkud-chrome-profile
```

Launch Chrome with remote debugging enabled (keep this running):

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/shopkud-chrome-profile \
  --no-first-run \
  --no-default-browser-check
```

### Linux Setup

```bash
mkdir -p ~/shopkud-chrome-profile

google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/shopkud-chrome-profile \
  --no-first-run \
  --no-default-browser-check
```

### Windows Setup

```cmd
mkdir %USERPROFILE%\shopkud-chrome-profile

"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir=%USERPROFILE%\shopkud-chrome-profile ^
  --no-first-run ^
  --no-default-browser-check
```

**Note:** The debug port binds to localhost (127.0.0.1) only, never exposed externally.

## 3. Log In to Shopee Affiliate

Once Chrome starts with the dedicated profile:

1. Navigate to `https://affiliate.shopee.co.th`
2. Log in with your Shopee Affiliate account
3. Complete any verification if needed
4. **Keep Chrome running** with this profile

## 4. Start the MCP Server

In a new terminal:

```bash
export SHOPKUD_DB_PATH=./shopkud.db
export CHROME_CDP_URL=http://127.0.0.1:9222

npm run build
node dist/mcp/server.js
```

The MCP server will connect to Chrome via CDP and expose tools over stdio.

## 5. Start the Local Web Console

In another terminal:

```bash
export SHOPKUD_DB_PATH=./shopkud.db
export CHROME_CDP_URL=http://127.0.0.1:9222
export CONSOLE_PORT=3000

npm run console
```

Open your browser to `http://localhost:3000` to access the console.

## 6. Optional: Configure Affiliate Open API

For future API integration (currently a stub):

```bash
export SHOPEE_AFFILIATE_API_URL=https://open-api.affiliate.shopee.co.th/graphql
export SHOPEE_AFFILIATE_API_KEY=your-api-key-here
```

**Never commit API keys.** Use environment variables or a `.env` file (not tracked by git).

## Testing

### Run All Tests

```bash
npm test
```

### Run Bot Detection Tests

Requires Chrome running on port 9222:

```bash
npm run test:bot
```

This will test against:
- bot.sannysoft.com
- rebrowser bot-detector
- CreepJS

Results are saved to `test-results/bot-detection.json`.

### Run Mock Shopee Site

```bash
npm run mock-shopee
```

The mock site runs on `http://localhost:3001` and simulates Shopee's signed API calls.

## Database Migration

If you have an existing ShopKud database with single `sub_id` column, the migration happens automatically:

1. Old links are migrated with `sub_id` → `sub_id1`
2. New links can use all 5 Sub ID slots
3. Old attribution data is preserved

Test the migration:

```bash
npm test tests/database-migration.test.ts
```

## Security Notes

1. **Dedicated Profile:** Never use your personal Chrome profile
2. **No Credentials:** Never commit cookies, tokens, or API keys
3. **Localhost Only:** CDP port 9222 binds to 127.0.0.1
4. **No Auto-Captcha:** The system stops on CAPTCHA and requires manual intervention
5. **No Tracking Clicks:** Link verification does NOT follow affiliate redirects

## Troubleshooting

### "Failed to connect to CDP"

- Ensure Chrome is running with `--remote-debugging-port=9222`
- Check that no other process is using port 9222
- Try restarting Chrome

### "CAPTCHA detected"

- This is expected behavior
- Solve the CAPTCHA manually in the Chrome window
- The system will resume after verification

### "Chrome contexts not found"

- The profile may be locked by another Chrome instance
- Close all Chrome windows and restart with the dedicated profile

### Rate Limiting

The CDP controller includes:
- Human-paced delays (1-3s random)
- One-at-a-time queue per origin
- Automatic CAPTCHA detection

## Next Steps

- Create your first affiliate link via the console
- Test batch creation
- View the job queue status
- Explore commission offers

## Architecture

```
┌─────────────────┐
│  Local Console  │ http://localhost:3000
│  (Express UI)   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  MCP Server     │ stdio transport
│  (Node.js)      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ CDP Controller  │ patchright
│  (Playwright)   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Chrome Profile │ port 9222 (localhost)
│  (Logged In)    │
└─────────────────┘
```

## Support

For issues or questions, refer to the test suite and `docs/REVIEW-NOTES.md`.
