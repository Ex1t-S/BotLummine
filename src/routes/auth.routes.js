import { Router } from 'express';
import { attachUser } from '../middleware/auth.js';
import { getLogin, postLogin, logout } from '../controllers/auth.controller.js';

const router = Router();

router.use(attachUser);

router.get('/', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  return res.redirect('/login');
});

router.get('/login', getLogin);
router.post('/login', postLogin);
router.post('/logout', logout);

export default router;
