export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  paynow: {
    integrationId: process.env.PAYNOW_INTEGRATION_ID,
    integrationKey: process.env.PAYNOW_INTEGRATION_KEY,
    resultUrl: process.env.PAYNOW_RESULT_URL,
    returnUrl: process.env.PAYNOW_RETURN_URL,
  },
});
