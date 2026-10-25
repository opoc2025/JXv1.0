import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 不需要登录的路径
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];
const STATIC_PATHS = ['/_next', '/favicon.ico', '/robots.txt', '/api/auth/me'];

function isAuthenticated(request: NextRequest): boolean {
  const cookie = request.cookies.get('admin_auth');
  if (!cookie?.value) return false;

  // 简单的密码比对（从 .env 读取）
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;

  // cookie 值格式: "sha256hash"（登录时存的 hash）
  return cookie.value === expected;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 放行静态资源
  if (STATIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 放行公开路径
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // 未登录 → 跳转登录
  if (!isAuthenticated(request)) {
    // API 路由返回 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
    }

    // 页面路由 → 307 跳登录页（带 redirect 参数）
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl, 307);
  }

  // 已登录访问 /login → 跳首页
  if (pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 保护所有页面和 API
    '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
