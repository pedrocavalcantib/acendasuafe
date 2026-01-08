// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://idztfygeodtnncdjcypk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkenRmeWdlb2R0bm5jZGpjeXBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5OTQ5NTcsImV4cCI6MjA4MTU3MDk1N30.fYkZUbWuR5LDk4Og7c94mwfx3lb_MQkntxRvz6fZmmw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);