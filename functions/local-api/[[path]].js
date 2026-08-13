const UPSTREAM_BASE = "https://gptpayserve.catfree.me/api/v1";
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const ROUTES = {
  "/local-api/user": {
    method: "GET",
    path: "/third-party/user",
    payload: () => undefined,
  },
  "/local-api/orders/direct": {
    method: "POST",
    path: "/third-party/orders/direct",
    payload: (body) => {
      if (!body.payload || Array.isArray(body.payload) || typeof body.payload !== "object") {
        throw new ProxyError(400, "充值请求内容不完整");
      }
      return body.payload;
    },
  },
  "/local-api/orders/status": {
    method: "POST",
    path: "/third-party/orders/status",
    payload: (body) => {
      const cardKey = body.cardKey;
      const validString = typeof cardKey === "string" && cardKey.trim().length >= 1 && cardKey.trim().length <= 128;
      const validArray = Array.isArray(cardKey) && cardKey.length > 0 && cardKey.every(
        (value) => typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 128,
      );

      if (!validString && !validArray) {
        throw new ProxyError(400, "订单查询卡密格式不正确");
      }

      return {
        cardKey: validString ? cardKey.trim() : cardKey.map((value) => value.trim()),
      };
    },
  },
};

class ProxyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function validateSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new ProxyError(403, "请求来源无效");
  }
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ProxyError(415, "请求必须使用 JSON 格式");
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ProxyError(413, "请求内容过大");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ProxyError(413, "请求内容过大");
  }

  try {
    const body = JSON.parse(text);
    if (!body || Array.isArray(body) || typeof body !== "object") {
      throw new Error("invalid object");
    }
    return body;
  } catch (_error) {
    throw new ProxyError(400, "请求 JSON 格式不正确");
  }
}

export async function onRequest(context) {
  try {
    const { request } = context;
    const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    const route = ROUTES[pathname];

    if (!route) {
      return jsonResponse(404, { code: -1, detail: "接口路径不存在" });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { code: -1, detail: "本地代理仅支持 POST 请求" });
    }

    validateSameOrigin(request);
    const body = await readJson(request);
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey || apiKey.length > 8192) {
      throw new ProxyError(400, "API Key 不能为空或格式异常");
    }

    const payload = route.payload(body);
    const upstream = await fetch(`${UPSTREAM_BASE}${route.path}`, {
      method: route.method,
      headers: {
        "X-API-Key": apiKey,
        ...(route.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: route.method === "POST" ? JSON.stringify(payload) : undefined,
    });

    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json; charset=utf-8");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    if (error instanceof ProxyError) {
      return jsonResponse(error.status, { code: -1, detail: error.message });
    }
    const diagnosticCode = error instanceof TypeError ? "WORKER_FETCH_TYPE_ERROR" : "WORKER_FETCH_ERROR";
    return jsonResponse(502, {
      code: -1,
      detail: "无法连接远程 API，请稍后重试",
      diagnosticCode,
    });
  }
}
