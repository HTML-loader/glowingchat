# glowingchat — Take Uno

A browser-based community chat app using HTML, CSS, JavaScript and Supabase.

## Files
- `index.html` — app shell and navigation
- `src/config.js` — Supabase project configuration
- `src/styles.css` — responsive dark/light/neon themes
- `src/app.js` — frontend behavior
- `supabase/schema.sql` — initial database schema and row-level security policies

## Setup
1. Create a Supabase project.
2. Open the SQL Editor and run `supabase/schema.sql`.
3. In Supabase → Project Settings → API, copy the Project URL and anon/public key.
4. Paste them into `src/config.js`. Never use the `service_role` key in browser code.
5. In Supabase Storage, create a private bucket named `message-images`.
6. Configure bucket policies so users can upload only into a folder named with their own auth user ID, and can read files only when allowed by the parent message/conversation.
7. Serve this folder from a local web server or static host. ES modules generally do not work when opening `index.html` directly as a `file://` URL.

## Creator setup
After registering the METALBEAM account, run this once in the Supabase SQL Editor:

```sql
update public.profiles
set role = 'creator'
where username = 'METALBEAM';
```

Only do this for the intended creator account.

## Current implementation status
This is the first code foundation, not a production-ready launch. It includes the app shell, authentication flow, basic public messaging, basic conversation display, announcements display, profile editing, settings persistence, report submission, and initial creator warning/ban/report screens.

The complete planned product still needs additional implementation and testing, including:
- Secure conversation creation and private-message recipient flow from profiles
- Moderation Report profile and automated appeal-to-DM delivery
- Ban screen and server-side ban enforcement/automatic TEMP expiration
- Admin warning notification fan-out and DND exception logic
- Warning-before-action moderation workflow and audited edit/delete/image removal
- Announcement-to-public-chat paired post creation and image attachments
- Profile discovery/viewing, profile reports, and avatar uploads
- Full message menu, pin/unpin confirmation, reply linking, and block filtering/presence masking
- Smart scroll behavior and new-message jump button
- Notifications UI and unread/read handling
- Complete image rendering and secure storage policies
- Realtime private conversations and online presence
- Password reauthentication UX, account settings confirmation dialogs, and robust username collision handling
- Security review of every RLS policy and server-side function

Do not launch with real users until the missing items and security checks are completed. The SQL schema is a starting point and should be reviewed before production.
