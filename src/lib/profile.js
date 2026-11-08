import { base44 } from "@/api/base44Client";
export function defaultHandle(user){const raw=user.handle|| (user.id ? `wallet_${user.id.slice(0,6)}` : 'anon');return raw.toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,20)||"anon";}
export async function ensureProfile(user,{create=true}={}){const[existing]=await base44.entities.Profile.filter({user_id:user.id});if(existing)return existing;const draft={user_id:user.id,handle:defaultHandle(user),bio:user.bio||"",avatar_url:user.avatar_url||""};return create?base44.entities.Profile.create(draft):{...draft,id:null};}
