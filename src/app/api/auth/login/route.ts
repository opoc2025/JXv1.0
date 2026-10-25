import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const password = body?.password;

    if (!password) {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
      return NextResponse.json(
        { error: '服务器未配置 ADMIN_PASSWORD' },
        { status: 500 }
      );
    }

    if (password !== expected) {
      return NextResponse.json({ error: '密码错误' }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });

    // Secure cookie 只在 Vercel (HTTPS) 上启用，localhost HTTP 不设
    // Vercel 自动注入 VERCEL=1，本地没有这个变量
    const secure = !!process.env.VERCEL;

    response.cookies.set('admin_auth', password, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
