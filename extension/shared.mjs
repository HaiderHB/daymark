export function allowedDomain(host, sites, browser) {
  return (
    sites.find((s) => s.browser === browser && (host === s.domain || host.endsWith('.' + s.domain)))
      ?.domain || null
  );
}
export function permissionOrigins(sites, browser, aiWebEnabled = false) {
  return [
    ...new Set(
      [
        ...sites,
        ...(aiWebEnabled
          ? [
              { browser, domain: 'chatgpt.com' },
              { browser, domain: 'claude.ai' },
            ]
          : []),
      ]
        .filter((s) => s.browser === browser)
        .flatMap((s) => [`https://${s.domain}/*`, `https://*.${s.domain}/*`]),
    ),
  ];
}
