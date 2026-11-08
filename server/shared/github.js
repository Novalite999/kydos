// Shared GitHub API helper for the releases page (admin only).
const DEFAULT_REPO = "Novalite999/kydos";

export function repoSlug() {
  const configured = process.env.GH_REPO;
  return configured && configured.includes("/") ? configured : DEFAULT_REPO;
}

export async function assertGithubAdmin(ctx) {
  const user = await ctx.auth.me().catch(() => null);
  if (user?.role === "admin") return null;
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

export async function githubToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw Object.assign(new Error("GITHUB_TOKEN is not configured on the server."), { status: 503 });
  return token;
}

export async function githubApi(token, path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "kydos-release-log",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.message || `GitHub API ${res.status}`);
  return json;
}
