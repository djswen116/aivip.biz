(function installApiProxyAdapter() {
  "use strict";

  var upstreamBases = new Set([
    "https://gptpayserve.catfree.me/api/v1",
    "https://autoserve.de10.online/api/v1",
  ]);
  var routes = {
    "/third-party/user": "/local-api/user",
    "/third-party/orders/direct": "/local-api/orders/direct",
    "/third-party/orders/status": "/local-api/orders/status",
    "/third-party/orders/lookup": "/local-api/orders/lookup",
  };
  var originalFetch = window.fetch.bind(window);

  window.fetch = function proxyAwareFetch(resource, options) {
    var requestUrl;

    try {
      requestUrl = new URL(
        typeof resource === "string" ? resource : resource.url,
        window.location.href,
      );
    } catch (_error) {
      return originalFetch(resource, options);
    }

    if (!upstreamBases.has(requestUrl.origin + "/api/v1")) {
      return originalFetch(resource, options);
    }

    var localPath = routes[requestUrl.pathname.replace("/api/v1", "")];
    if (!localPath) {
      return originalFetch(resource, options);
    }

    var requestOptions = options || {};
    var headers = new Headers(requestOptions.headers || {});
    var apiKey = (headers.get("X-API-Key") || "").trim();
    var upstreamBody = null;

    if (requestOptions.body) {
      try {
        upstreamBody = JSON.parse(requestOptions.body);
      } catch (_error) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: -1, detail: "代理请求 JSON 格式不正确" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            },
          ),
        );
      }
    }

    var localBody = { apiKey: apiKey };
    if (localPath === "/local-api/orders/direct") {
      localBody.payload = upstreamBody;
    } else if (localPath === "/local-api/orders/status") {
      localBody.cardKey = upstreamBody && upstreamBody.cardKey;
    } else if (localPath === "/local-api/orders/lookup") {
      localBody.cardNumber = upstreamBody && upstreamBody.cardNumber;
      localBody.email = upstreamBody && upstreamBody.email;
    }

    return originalFetch(localPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(localBody),
      cache: "no-store",
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
    });
  };
})();
