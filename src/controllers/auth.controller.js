import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { clearAuthCookie, issueAuthCookie } from '../middleware/auth.js';

export function getLogin(req, res) {
  if (req.user) return res.redirect('/dashboard');
  return res.render('login', {
    title: 'Ingresar',
    error: null
  });
}

export async function postLogin(req, res) {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email: String(email || '').trim().toLowerCase() }
  });

  if (!user) {
    return res.status(401).render('login', {
      title: 'Ingresar',
      error: 'Email o contraseña incorrectos.'
    });
  }

  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);

  if (!ok) {
    return res.status(401).render('login', {
      title: 'Ingresar',
      error: 'Email o contraseña incorrectos.'
    });
  }

  issueAuthCookie(res, user);
  return res.redirect('/dashboard');
}

export function logout(_req, res) {
  clearAuthCookie(res);
  return res.redirect('/login');
}
