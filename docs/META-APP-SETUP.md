# Meta App setup

This app uses your existing Meta Developer App. Required product: **Facebook Login for Business** (or Facebook Login) and **Webhooks**.

## 1. Basic settings
- App domains: `app.yourdomain.com`
- Privacy policy / terms URLs: required for App Review
- Business verification: required for Advanced Access to Page permissions

## 2. Facebook Login
- Valid OAuth Redirect URIs: `https://app.yourdomain.com/api/meta/callback`
- Login with the JavaScript SDK: not used (server-side OAuth only)
- Client OAuth login: ON · Web OAuth login: ON · Enforce HTTPS: ON · Use Strict Mode for redirect URIs: ON

## 3. Permissions (App Review)
| Permission | Used for |
|---|---|
| `pages_show_list` | listing the Pages the user manages |
| `pages_read_engagement` | reading comments and post metadata |
| `pages_read_user_content` | reading user comments on the Page |
| `pages_manage_engagement` | hiding/unhiding comments, replying as the Page |
| `pages_manage_metadata` | subscribing the Page to webhooks |
| `pages_messaging` | Messenger inbox: reading and replying to messages |

While the app is in Development mode these work for app roles (admins/developers/testers) on their own Pages — ideal for the internal businesses. For external customers' Pages you need Advanced Access via App Review: submit screencasts of connecting a Page, the review queue, hiding a comment and replying in the inbox. The app's shadow mode + explicit activation of automation are useful points to mention in the review notes.

If a permission is declined, the Page shows `PERMISSION_MISSING` with the missing scope list and a Reconnect button; Messenger stays read-only without `pages_messaging`.

## 4. Webhooks
- Object: **Page**
- Callback URL: `https://app.yourdomain.com/api/webhooks/meta`
- Verify token: the value of `META_WEBHOOK_VERIFY_TOKEN`
- Subscribed fields: `feed`, `messages`, `messaging_postbacks`, `message_reads`

The verify handshake (`GET`) and signature check (`X-Hub-Signature-256` over the raw body with the app secret) are implemented. Completing OAuth does **not** subscribe a Page automatically: the app calls `POST /{page}/subscribed_apps` for each selected Page and then reads back `subscribed_apps` to verify; the Pages screen shows "webhook not verified" if that failed. A health check re-verifies tokens and subscriptions every 6 hours.

## 5. Testing in development
1. Add your Facebook account as an app admin/tester
2. Use `https://<staging-host>/api/meta/callback` as a redirect URI (sslip.io is fine for staging)
3. Connect a test Page, comment on a post from another account, and watch it appear in AI Moderation within seconds
4. Use the Graph API Explorer to confirm `subscribed_apps` for the Page

## 6. Messaging policy
Standard messaging window: replies within 24 hours of the customer's last message. After that the inbox requires a message tag (`HUMAN_AGENT` within 7 days, etc.). The app never initiates conversations.

## 7. Going from Development to Live
- Switch the app to Live mode after Advanced Access is granted
- Keep `META_AUTOMATION_ENABLED=false` until shadow mode results look right
- Rotate the app secret if it was ever committed or shared; set the new value in `.env` and redeploy
