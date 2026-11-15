/**
 * Default transactional templates (en + bn). Stored in the DB on seed so Super Admin can edit them;
 * this file is the fallback and the seed source.
 *
 * Body syntax: paragraphs separated by blank lines; `{{var}}` placeholders; a line starting with
 * `> ` renders as a highlighted note. Links/CTAs are rendered from `ctaUrl` variable + ctaLabel.
 */
export type TemplateDef = {
  key: string;
  category: "AUTH" | "ACCOUNT" | "BILLING" | "OPERATIONAL" | "MARKETING";
  en: { subject: string; body: string; ctaLabel?: string };
  bn: { subject: string; body: string; ctaLabel?: string };
};

export const TEMPLATES: TemplateDef[] = [
  // ───── Authentication ─────
  {
    key: "auth.welcome",
    category: "AUTH",
    en: { subject: "Welcome to {{appName}}", body: "Hi {{name}},\n\nYour account is ready. You can now connect your Facebook Pages, configure AI moderation and manage conversations from one place.\n\nIf you did not create this account, please contact support.", ctaLabel: "Open dashboard" },
    bn: { subject: "{{appName}}-এ স্বাগতম", body: "প্রিয় {{name}},\n\nআপনার অ্যাকাউন্ট প্রস্তুত। এখন আপনি ফেসবুক পেজ যুক্ত করতে, AI মডারেশন কনফিগার করতে এবং এক জায়গা থেকে সব কথোপকথন পরিচালনা করতে পারবেন।\n\nআপনি এই অ্যাকাউন্ট তৈরি না করে থাকলে সাপোর্টে যোগাযোগ করুন।", ctaLabel: "ড্যাশবোর্ড খুলুন" },
  },
  {
    key: "auth.verify_email",
    category: "AUTH",
    en: { subject: "Verify your email address", body: "Hi {{name}},\n\nPlease confirm your email address to activate your {{appName}} account.\n\n> This link expires in {{expiresMinutes}} minutes.", ctaLabel: "Verify email" },
    bn: { subject: "আপনার ইমেইল ঠিকানা যাচাই করুন", body: "প্রিয় {{name}},\n\nআপনার {{appName}} অ্যাকাউন্ট সক্রিয় করতে ইমেইল ঠিকানা নিশ্চিত করুন।\n\n> এই লিংক {{expiresMinutes}} মিনিট পর মেয়াদোত্তীর্ণ হবে।", ctaLabel: "ইমেইল যাচাই করুন" },
  },
  {
    key: "auth.forgot_password",
    category: "AUTH",
    en: { subject: "Reset your password", body: "Hi {{name}},\n\nWe received a request to reset the password for your account. Click the button below to choose a new password.\n\n> This link expires in {{expiresMinutes}} minutes and can be used once. If you did not request a reset, you can ignore this email — your password will not change.", ctaLabel: "Reset password" },
    bn: { subject: "আপনার পাসওয়ার্ড রিসেট করুন", body: "প্রিয় {{name}},\n\nআপনার অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ পেয়েছি। নতুন পাসওয়ার্ড দিতে নিচের বাটনে ক্লিক করুন।\n\n> এই লিংক {{expiresMinutes}} মিনিট পর মেয়াদোত্তীর্ণ হবে এবং একবারই ব্যবহার করা যাবে। আপনি অনুরোধ না করে থাকলে এই ইমেইল উপেক্ষা করুন।", ctaLabel: "পাসওয়ার্ড রিসেট" },
  },
  {
    key: "auth.password_changed",
    category: "AUTH",
    en: { subject: "Your password was changed", body: "Hi {{name}},\n\nThe password for your {{appName}} account was changed on {{when}}. All other sessions have been signed out.\n\n> If this was not you, reset your password immediately and contact support at {{supportEmail}}.", ctaLabel: "Review security" },
    bn: { subject: "আপনার পাসওয়ার্ড পরিবর্তন হয়েছে", body: "প্রিয় {{name}},\n\n{{when}} তারিখে আপনার {{appName}} অ্যাকাউন্টের পাসওয়ার্ড পরিবর্তন করা হয়েছে। অন্য সব সেশন সাইন-আউট করা হয়েছে।\n\n> এটি আপনি না করে থাকলে এখনই পাসওয়ার্ড রিসেট করুন এবং {{supportEmail}}-এ যোগাযোগ করুন।", ctaLabel: "সিকিউরিটি দেখুন" },
  },
  {
    key: "auth.new_login",
    category: "AUTH",
    en: { subject: "New sign-in to your account", body: "Hi {{name}},\n\nA new sign-in to your account was detected.\n\nDevice: {{device}}\nIP address: {{ip}}\nTime: {{when}}\n\n> If this was not you, change your password and revoke sessions from Settings → Security.", ctaLabel: "Review sessions" },
    bn: { subject: "আপনার অ্যাকাউন্টে নতুন সাইন-ইন", body: "প্রিয় {{name}},\n\nআপনার অ্যাকাউন্টে একটি নতুন সাইন-ইন শনাক্ত হয়েছে।\n\nডিভাইস: {{device}}\nআইপি: {{ip}}\nসময়: {{when}}\n\n> এটি আপনি না হলে পাসওয়ার্ড পরিবর্তন করুন এবং সেটিংস → সিকিউরিটি থেকে সেশন বাতিল করুন।", ctaLabel: "সেশন দেখুন" },
  },
  // ───── Account & service ─────
  {
    key: "account.created",
    category: "ACCOUNT",
    en: { subject: "Your {{appName}} business account is ready", body: "Hi {{name}},\n\nA business account for {{workspaceName}} has been created for you. Use the button below to set your password and sign in.", ctaLabel: "Set up account" },
    bn: { subject: "আপনার {{appName}} বিজনেস অ্যাকাউন্ট প্রস্তুত", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর জন্য একটি বিজনেস অ্যাকাউন্ট তৈরি হয়েছে। পাসওয়ার্ড সেট করে সাইন-ইন করতে নিচের বাটনে ক্লিক করুন।", ctaLabel: "অ্যাকাউন্ট সেটআপ" },
  },
  {
    key: "account.invitation",
    category: "ACCOUNT",
    en: { subject: "{{inviterName}} invited you to {{workspaceName}}", body: "Hi,\n\n{{inviterName}} has invited you to join {{workspaceName}} on {{appName}} as {{roleName}}.\n\n> This invitation expires in {{expiresDays}} days. If you already have an account, you will be asked to sign in first.", ctaLabel: "Accept invitation" },
    bn: { subject: "{{inviterName}} আপনাকে {{workspaceName}}-এ আমন্ত্রণ জানিয়েছেন", body: "প্রিয়,\n\n{{inviterName}} আপনাকে {{appName}}-এ {{workspaceName}} ওয়ার্কস্পেসে {{roleName}} হিসেবে যোগ দিতে আমন্ত্রণ জানিয়েছেন।\n\n> আমন্ত্রণটি {{expiresDays}} দিন পর মেয়াদোত্তীর্ণ হবে। আপনার অ্যাকাউন্ট থাকলে আগে সাইন-ইন করতে বলা হবে।", ctaLabel: "আমন্ত্রণ গ্রহণ" },
  },
  {
    key: "account.role_changed",
    category: "ACCOUNT",
    en: { subject: "Your role in {{workspaceName}} was updated", body: "Hi {{name}},\n\nYour role in {{workspaceName}} is now {{roleName}}. Your permissions have been updated accordingly.", ctaLabel: "Open workspace" },
    bn: { subject: "{{workspaceName}}-এ আপনার ভূমিকা পরিবর্তন হয়েছে", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এ আপনার ভূমিকা এখন {{roleName}}। সে অনুযায়ী অনুমতিগুলো হালনাগাদ হয়েছে।", ctaLabel: "ওয়ার্কস্পেস খুলুন" },
  },
  {
    key: "account.approved",
    category: "ACCOUNT",
    en: { subject: "{{workspaceName}} has been approved", body: "Hi {{name}},\n\nYour business account {{workspaceName}} has been approved. All features included in your plan are now active.", ctaLabel: "Get started" },
    bn: { subject: "{{workspaceName}} অনুমোদিত হয়েছে", body: "প্রিয় {{name}},\n\nআপনার বিজনেস অ্যাকাউন্ট {{workspaceName}} অনুমোদিত হয়েছে। আপনার প্ল্যানের সব ফিচার এখন সক্রিয়।", ctaLabel: "শুরু করুন" },
  },
  {
    key: "account.suspended",
    category: "ACCOUNT",
    en: { subject: "{{workspaceName}} has been suspended", body: "Hi {{name}},\n\nYour business account {{workspaceName}} has been suspended. Reason: {{reason}}\n\nAutomated moderation and replies are paused. Please contact {{supportEmail}} to resolve this.", ctaLabel: "Contact support" },
    bn: { subject: "{{workspaceName}} স্থগিত করা হয়েছে", body: "প্রিয় {{name}},\n\nআপনার বিজনেস অ্যাকাউন্ট {{workspaceName}} স্থগিত করা হয়েছে। কারণ: {{reason}}\n\nস্বয়ংক্রিয় মডারেশন ও রিপ্লাই বন্ধ আছে। সমাধানের জন্য {{supportEmail}}-এ যোগাযোগ করুন।", ctaLabel: "সাপোর্টে যোগাযোগ" },
  },
  {
    key: "service.activated",
    category: "ACCOUNT",
    en: { subject: "Service activated: {{serviceName}}", body: "Hi {{name}},\n\n{{serviceName}} is now active for {{workspaceName}}.", ctaLabel: "Open dashboard" },
    bn: { subject: "সার্ভিস সক্রিয়: {{serviceName}}", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর জন্য {{serviceName}} এখন সক্রিয়।", ctaLabel: "ড্যাশবোর্ড খুলুন" },
  },
  {
    key: "service.deactivated",
    category: "ACCOUNT",
    en: { subject: "Service deactivated: {{serviceName}}", body: "Hi {{name}},\n\n{{serviceName}} has been deactivated for {{workspaceName}}. Reason: {{reason}}", ctaLabel: "View billing" },
    bn: { subject: "সার্ভিস নিষ্ক্রিয়: {{serviceName}}", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর জন্য {{serviceName}} নিষ্ক্রিয় করা হয়েছে। কারণ: {{reason}}", ctaLabel: "বিলিং দেখুন" },
  },
  {
    key: "service.expiring",
    category: "ACCOUNT",
    en: { subject: "Your subscription expires in {{days}} days", body: "Hi {{name}},\n\nThe {{planName}} subscription for {{workspaceName}} expires on {{date}}. Renew now to avoid interruption of AI moderation and Messenger services.", ctaLabel: "Renew now" },
    bn: { subject: "আপনার সাবস্ক্রিপশন {{days}} দিনে শেষ হবে", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর {{planName}} সাবস্ক্রিপশন {{date}} তারিখে শেষ হবে। AI মডারেশন ও মেসেঞ্জার সার্ভিস নিরবচ্ছিন্ন রাখতে এখনই রিনিউ করুন।", ctaLabel: "এখনই রিনিউ" },
  },
  {
    key: "subscription.changed",
    category: "ACCOUNT",
    en: { subject: "Subscription {{direction}}: {{planName}}", body: "Hi {{name}},\n\nThe subscription for {{workspaceName}} has been {{direction}} to the {{planName}} plan. New limits apply immediately.", ctaLabel: "View plan" },
    bn: { subject: "সাবস্ক্রিপশন {{direction}}: {{planName}}", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর সাবস্ক্রিপশন {{planName}} প্ল্যানে {{direction}} হয়েছে। নতুন লিমিট এখন থেকে প্রযোজ্য।", ctaLabel: "প্ল্যান দেখুন" },
  },
  // ───── Billing ─────
  {
    key: "billing.invoice",
    category: "BILLING",
    en: { subject: "Invoice {{invoiceNumber}} for {{workspaceName}}", body: "Hi {{name}},\n\nA new invoice of {{amount}} is available for {{workspaceName}}. It is due on {{dueDate}}.", ctaLabel: "View invoice" },
    bn: { subject: "{{workspaceName}}-এর ইনভয়েস {{invoiceNumber}}", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর জন্য {{amount}} টাকার একটি নতুন ইনভয়েস তৈরি হয়েছে। পরিশোধের শেষ তারিখ {{dueDate}}।", ctaLabel: "ইনভয়েস দেখুন" },
  },
  {
    key: "billing.payment_received",
    category: "BILLING",
    en: { subject: "Payment received — {{amount}}", body: "Hi {{name}},\n\nWe received your payment of {{amount}} for invoice {{invoiceNumber}}. Thank you!\n\nThis email is your receipt.", ctaLabel: "View receipt" },
    bn: { subject: "পেমেন্ট গৃহীত — {{amount}}", body: "প্রিয় {{name}},\n\nইনভয়েস {{invoiceNumber}}-এর জন্য আপনার {{amount}} পেমেন্ট পেয়েছি। ধন্যবাদ!\n\nএই ইমেইলটি আপনার রসিদ।", ctaLabel: "রসিদ দেখুন" },
  },
  {
    key: "billing.payment_failed",
    category: "BILLING",
    en: { subject: "Payment failed for invoice {{invoiceNumber}}", body: "Hi {{name}},\n\nWe could not process the payment of {{amount}} for {{workspaceName}}. Reason: {{reason}}\n\nPlease update your payment method or pay manually before {{graceDate}} to avoid service suspension.", ctaLabel: "Fix payment" },
    bn: { subject: "ইনভয়েস {{invoiceNumber}}-এর পেমেন্ট ব্যর্থ", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর {{amount}} পেমেন্ট প্রক্রিয়া করা যায়নি। কারণ: {{reason}}\n\nসার্ভিস স্থগিত এড়াতে {{graceDate}}-এর আগে পেমেন্ট পদ্ধতি আপডেট করুন বা ম্যানুয়ালি পরিশোধ করুন।", ctaLabel: "পেমেন্ট ঠিক করুন" },
  },
  {
    key: "billing.reminder",
    category: "BILLING",
    en: { subject: "Reminder: invoice {{invoiceNumber}} is due {{dueDate}}", body: "Hi {{name}},\n\nThis is a friendly reminder that invoice {{invoiceNumber}} ({{amount}}) for {{workspaceName}} is due on {{dueDate}}.", ctaLabel: "Pay now" },
    bn: { subject: "রিমাইন্ডার: ইনভয়েস {{invoiceNumber}} {{dueDate}} তারিখে পরিশোধ্য", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর ইনভয়েস {{invoiceNumber}} ({{amount}}) {{dueDate}} তারিখে পরিশোধ্য — এটি একটি বন্ধুত্বপূর্ণ রিমাইন্ডার।", ctaLabel: "এখনই পরিশোধ" },
  },
  {
    key: "billing.renewal_upcoming",
    category: "BILLING",
    en: { subject: "Your {{planName}} plan renews on {{date}}", body: "Hi {{name}},\n\nThe {{planName}} subscription for {{workspaceName}} will renew on {{date}} for {{amount}}. No action is needed if your billing details are up to date.", ctaLabel: "Manage subscription" },
    bn: { subject: "আপনার {{planName}} প্ল্যান {{date}} তারিখে রিনিউ হবে", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর {{planName}} সাবস্ক্রিপশন {{date}} তারিখে {{amount}} দিয়ে রিনিউ হবে। বিলিং তথ্য হালনাগাদ থাকলে কিছু করার দরকার নেই।", ctaLabel: "সাবস্ক্রিপশন ম্যানেজ" },
  },
  {
    key: "billing.trial_ending",
    category: "BILLING",
    en: { subject: "Your trial ends in {{days}} days", body: "Hi {{name}},\n\nYour free trial for {{workspaceName}} ends on {{date}}. Choose a plan to keep AI moderation, Messenger inbox and CRM running without interruption.", ctaLabel: "Choose a plan" },
    bn: { subject: "আপনার ট্রায়াল {{days}} দিনে শেষ হবে", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর ফ্রি ট্রায়াল {{date}} তারিখে শেষ হবে। AI মডারেশন, মেসেঞ্জার ইনবক্স ও CRM চালু রাখতে একটি প্ল্যান বেছে নিন।", ctaLabel: "প্ল্যান বেছে নিন" },
  },
  {
    key: "billing.subscription_expired",
    category: "BILLING",
    en: { subject: "Your subscription has expired", body: "Hi {{name}},\n\nThe subscription for {{workspaceName}} expired on {{date}}. Automated features are paused and your data is retained according to our retention policy. Renew to restore full service.", ctaLabel: "Renew subscription" },
    bn: { subject: "আপনার সাবস্ক্রিপশন মেয়াদোত্তীর্ণ", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর সাবস্ক্রিপশন {{date}} তারিখে শেষ হয়েছে। স্বয়ংক্রিয় ফিচারগুলো বন্ধ আছে এবং আপনার ডেটা সংরক্ষণ নীতি অনুযায়ী রাখা হয়েছে। পূর্ণ সার্ভিস ফিরে পেতে রিনিউ করুন।", ctaLabel: "রিনিউ করুন" },
  },
  // ───── Operational ─────
  {
    key: "ops.page_disconnected",
    category: "OPERATIONAL",
    en: { subject: "Facebook Page disconnected: {{pageName}}", body: "Hi {{name}},\n\nThe Facebook Page {{pageName}} was disconnected from {{workspaceName}} by {{actor}}. AI moderation and replies for this Page have stopped. Historical data is preserved.", ctaLabel: "Manage Pages" },
    bn: { subject: "ফেসবুক পেজ ডিসকানেক্ট: {{pageName}}", body: "প্রিয় {{name}},\n\n{{actor}} {{workspaceName}} থেকে ফেসবুক পেজ {{pageName}} ডিসকানেক্ট করেছেন। এই পেজের AI মডারেশন ও রিপ্লাই বন্ধ হয়েছে। পুরনো ডেটা সংরক্ষিত আছে।", ctaLabel: "পেজ ম্যানেজ" },
  },
  {
    key: "ops.permission_revoked",
    category: "OPERATIONAL",
    en: { subject: "Action needed: Facebook permission expired for {{pageName}}", body: "Hi {{name}},\n\nThe access token for {{pageName}} is no longer valid ({{reason}}). Moderation and Messenger sync are paused until the Page is reconnected.", ctaLabel: "Reconnect Page" },
    bn: { subject: "পদক্ষেপ দরকার: {{pageName}}-এর ফেসবুক অনুমতি মেয়াদোত্তীর্ণ", body: "প্রিয় {{name}},\n\n{{pageName}}-এর অ্যাক্সেস টোকেন আর বৈধ নয় ({{reason}})। পেজ পুনরায় সংযুক্ত না করা পর্যন্ত মডারেশন ও মেসেঞ্জার সিঙ্ক বন্ধ থাকবে।", ctaLabel: "পেজ পুনরায় সংযুক্ত" },
  },
  {
    key: "ops.ai_interrupted",
    category: "OPERATIONAL",
    en: { subject: "AI service interrupted for {{workspaceName}}", body: "Hi {{name}},\n\nAI processing for {{workspaceName}} is currently failing: {{reason}}\n\nComments are still being stored and will be analysed once the issue is resolved.", ctaLabel: "Check AI settings" },
    bn: { subject: "{{workspaceName}}-এর AI সার্ভিস বিঘ্নিত", body: "প্রিয় {{name}},\n\n{{workspaceName}}-এর AI প্রসেসিং বর্তমানে ব্যর্থ হচ্ছে: {{reason}}\n\nকমেন্টগুলো সংরক্ষিত হচ্ছে এবং সমস্যা সমাধান হলে বিশ্লেষণ করা হবে।", ctaLabel: "AI সেটিংস দেখুন" },
  },
  {
    key: "ops.ai_limit_approaching",
    category: "OPERATIONAL",
    en: { subject: "AI usage at {{percent}}% of your monthly allowance", body: "Hi {{name}},\n\n{{workspaceName}} has used {{percent}}% of its AI allowance for this month. When the limit is reached, automated analysis pauses until the next cycle or an upgrade.", ctaLabel: "View usage" },
    bn: { subject: "মাসিক AI সীমার {{percent}}% ব্যবহৃত", body: "প্রিয় {{name}},\n\n{{workspaceName}} এ মাসের AI সীমার {{percent}}% ব্যবহার করেছে। সীমা পূর্ণ হলে পরবর্তী সাইকেল বা আপগ্রেড পর্যন্ত স্বয়ংক্রিয় বিশ্লেষণ বন্ধ থাকবে।", ctaLabel: "ব্যবহার দেখুন" },
  },
  {
    key: "ops.ai_limit_reached",
    category: "OPERATIONAL",
    en: { subject: "AI usage limit reached", body: "Hi {{name}},\n\n{{workspaceName}} has reached its AI allowance for this month. Automated comment analysis and replies are paused. Upgrade your plan or add your own API key to continue.", ctaLabel: "Upgrade" },
    bn: { subject: "AI ব্যবহারের সীমা পূর্ণ", body: "প্রিয় {{name}},\n\n{{workspaceName}} এ মাসের AI সীমায় পৌঁছেছে। স্বয়ংক্রিয় কমেন্ট বিশ্লেষণ ও রিপ্লাই বন্ধ আছে। চালিয়ে যেতে প্ল্যান আপগ্রেড করুন বা নিজের API কী যুক্ত করুন।", ctaLabel: "আপগ্রেড" },
  },
  {
    key: "ops.moderation_incident",
    category: "OPERATIONAL",
    en: { subject: "Moderation alert on {{pageName}}", body: "Hi {{name}},\n\n{{summary}}\n\nReview the moderation queue to take action.", ctaLabel: "Open review queue" },
    bn: { subject: "{{pageName}}-এ মডারেশন সতর্কতা", body: "প্রিয় {{name}},\n\n{{summary}}\n\nপদক্ষেপ নিতে মডারেশন কিউ পর্যালোচনা করুন।", ctaLabel: "রিভিউ কিউ খুলুন" },
  },
  {
    key: "ops.config_changed",
    category: "OPERATIONAL",
    en: { subject: "Settings changed in {{workspaceName}}", body: "Hi {{name}},\n\n{{actor}} changed the following settings in {{workspaceName}}:\n\n{{changes}}\n\n> If this change was not expected, review the audit log.", ctaLabel: "View audit log" },
    bn: { subject: "{{workspaceName}}-এ সেটিংস পরিবর্তন", body: "প্রিয় {{name}},\n\n{{actor}} {{workspaceName}}-এ নিচের সেটিংস পরিবর্তন করেছেন:\n\n{{changes}}\n\n> পরিবর্তনটি প্রত্যাশিত না হলে অডিট লগ দেখুন।", ctaLabel: "অডিট লগ দেখুন" },
  },
  {
    key: "platform.notice",
    category: "ACCOUNT",
    en: { subject: "{{subject}}", body: "Hi {{name}},\n\n{{message}}", ctaLabel: "Open dashboard" },
    bn: { subject: "{{subject}}", body: "প্রিয় {{name}},\n\n{{message}}", ctaLabel: "ড্যাশবোর্ড খুলুন" },
  },
];
