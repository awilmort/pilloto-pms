import express, { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import crypto from 'crypto';
import User from '../models/User';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRegister, validateLogin, validateEmail, validatePasswordReset } from '../middleware/validation';
import { sendTokenResponse } from '../utils/jwt';
import { sendVerificationEmail, sendPasswordResetEmail, sendEmail } from '../utils/email';
import { TenantRequest, tenantLocalStorage } from '../middleware/tenantContext';
import Tenant from '../models/Tenant';

const router = express.Router();

// Rate limiting for auth routes (email+IP keyed, skip successful requests)
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // more forgiving; brute-force handled by account lock
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failed attempts
  keyGenerator: (req: Request) => {
    const email = (req.body as any)?.email ? String((req.body as any).email).toLowerCase().trim() : '';
    // Use library-provided IPv4/IPv6-safe IP key generator
    const ipKey = ipKeyGenerator(req.ip as string);
    return `${ipKey}|${email}`;
  }
});

const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 password reset requests per hour
  message: {
    success: false,
    message: 'Too many password reset requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', authRateLimit, validateRegister, async (req: Request, res: Response) => {
  try {
    return res.status(403).json({
      success: false,
      message: 'Registration is currently disabled. Please contact an administrator.'
    });

    const { firstName, lastName, email, password, phone } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Create new user
    const user = new User({
      firstName,
      lastName,
      email,
      password,
      phone,
      emailVerified: process.env.NODE_ENV === 'development' ? true : false // Auto-verify in development
    });

    await user.save();

    // In development, auto-login after registration
    if (process.env.NODE_ENV === 'development') {
      sendTokenResponse(res, 201, user, 'Registration successful! Welcome to Pilloto.');
    } else {
      // In production, require email verification
      const verificationToken = user.generateEmailVerificationToken();
      await user.save();

      // Send verification email
      try {
        await sendVerificationEmail(user, verificationToken);
      } catch (emailError) {
        console.error('Email send error:', emailError);
        // Continue with registration even if email fails
      }

      res.status(201).json({
        success: true,
        message: 'Registration successful! Please check your email to verify your account.',
        emailSent: true
      });
    }
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', authRateLimit, validateLogin, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const tenantId = (req as TenantRequest).tenantId;
    const isPlatform = (req as TenantRequest).isPlatformRequest;

    // Build the user query — scope by tenant for regular users; unscoped for platform
    const userQuery: Record<string, any> = { email };
    if (!isPlatform && tenantId) {
      userQuery.tenantId = tenantId;
    } else if (isPlatform) {
      // Platform login: only superadmin users (no tenantId on the document)
      userQuery.role = 'superadmin';
    }

    // Check if user exists
    const user = await User.findOne(userQuery).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked due to too many failed login attempts. Please try again later.'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Check if email is verified (only in production)
    if (process.env.NODE_ENV === 'production' && !user.emailVerified) {
      return res.status(401).json({
        success: false,
        message: 'Please verify your email address before logging in. Check your email for the verification link.'
      });
    }

    // Validate password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      // Increment login attempts
      await user.incLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0) {
      await user.resetLoginAttempts();
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    sendTokenResponse(res, 200, user, 'Login successful', tenantId);
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', (req, res) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

// @route   POST /api/auth/verify-email
// @desc    Verify user email
// @access  Public
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    // Hash the token to compare with stored token
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    // Update user as verified
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    // If there is a pendingEmail, apply it now
    if (user.pendingEmail) {
      user.email = user.pendingEmail;
      user.pendingEmail = undefined;
    }
    await user.save();

    // Send login token
    sendTokenResponse(res, 200, user, 'Email verified successfully! You are now logged in.', user.tenantId?.toString());
  } catch (error: any) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during email verification'
    });
  }
});

// @route   POST /api/auth/resend-verification
// @desc    Resend email verification
// @access  Public
router.post('/resend-verification', authRateLimit, validateEmail, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }

    // Generate new verification token
    const verificationToken = user.generateEmailVerificationToken();
    await user.save();

    // Send verification email
    await sendVerificationEmail(user, verificationToken);

    res.status(200).json({
      success: true,
      message: 'Verification email sent successfully'
    });
  } catch (error: any) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error sending verification email'
    });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
router.post('/forgot-password', passwordResetRateLimit, validateEmail, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if user exists or not
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Generate password reset token
    const resetToken = user.generatePasswordResetToken();
    await user.save();

    // Send password reset email
    try {
      await sendPasswordResetEmail(user, resetToken);
    } catch (emailError) {
      console.error('Password reset email error:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Error sending password reset email. Please try again later.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset request'
    });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password using token
// @access  Public
router.post('/reset-password', validatePasswordReset, async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    // Hash the token to compare with stored token
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Update password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    // Reset login attempts
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    res.status(200).json({
      success: true,
      user: req.user
    });
  } catch (error: any) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, phone, email } = req.body as { firstName?: string; lastName?: string; phone?: string; email?: string };

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;

    let emailChanged = false;
    if (email && email.toLowerCase().trim() !== user.email) {
      const newEmail = email.toLowerCase().trim();
      // Check uniqueness
      const existing = await User.findOne({ email: newEmail });
      if (existing && existing.id !== user.id) {
        return res.status(400).json({ success: false, message: 'Email is already in use' });
      }
      // Do not switch immediately; store as pending until verified
      user.pendingEmail = newEmail;
      const verificationToken = user.generateEmailVerificationToken();
      try {
        await sendVerificationEmail(user, verificationToken);
      } catch (emailError) {
        console.error('Email change verification send error:', emailError);
      }
      emailChanged = true;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: emailChanged
        ? 'Profile updated. Verification email sent — your email will update after verification.'
        : 'Profile updated successfully',
      user
    });
  } catch (error: any) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during profile update'
    });
  }
});

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password change'
    });
  }
});

// @route   POST /api/auth/lookup-tenant
// @desc    Given an email, return the tenant slug the user belongs to.
//          Used by login.pilloto.com to redirect users to their workspace.
// @access  Public (login portal only — runs in null tenant context)
router.post('/lookup-tenant', authRateLimit, async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    // Cross-tenant query — explicitly run outside tenant AsyncLocalStorage scope
    const user = await tenantLocalStorage.run(null, () =>
      User.findOne({ email, tenantId: { $exists: true, $ne: null } })
        .select('tenantId')
        .lean()
    );

    if (!user || !user.tenantId) {
      return res.status(404).json({ success: false, message: 'No workspace found for this email address.' });
    }

    const tenant = await tenantLocalStorage.run(null, () =>
      Tenant.findById(user.tenantId).select('slug name isActive').lean()
    );

    if (!tenant || !(tenant as any).isActive) {
      return res.status(404).json({ success: false, message: 'Workspace not found or inactive.' });
    }

    res.status(200).json({ success: true, data: { slug: (tenant as any).slug, name: (tenant as any).name } });
  } catch (error) {
    console.error('Lookup tenant error:', error);
    res.status(500).json({ success: false, message: 'Server error during workspace lookup.' });
  }
});

// ── Contact form (public — marketing site) ────────────────────────────────────
const contactRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15-minute window
  max: 5,                      // 5 submissions per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

const CONTACT_EMAIL = process.env.CONTACT_FORM_TO_EMAIL || 'info@pilloto.com';

const PLAN_LABELS: Record<string, string> = {
  basic: 'Basic',
  pro: 'Pro',
  enterprise: 'Enterprise',
  general: 'General inquiry',
};

router.post('/contact', contactRateLimit, async (req: Request, res: Response) => {
  try {
    const { name, email, phone, plan, message } = req.body as {
      name?: string; email?: string; phone?: string; plan?: string; message?: string;
    };

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return res.status(400).json({ success: false, message: 'Name, email, and message are required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }

    const planLabel = PLAN_LABELS[plan?.trim() ?? ''] ?? 'General inquiry';
    const safeName    = name.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeEmail   = email.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safePhone   = (phone ?? '').trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeMessage = message.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
        <div style="margin-bottom:24px">
          <span style="font-size:22px;font-weight:700;letter-spacing:-0.5px">Pilloto</span>
          <span style="font-size:13px;color:#888;margin-left:12px">New Contact Request</span>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin-bottom:24px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#666;width:140px;font-size:14px">Plan of interest</td>
              <td style="padding:8px 0;font-weight:600;font-size:14px">${planLabel}</td></tr>
          <tr><td style="padding:8px 0;color:#666;font-size:14px">Name</td>
              <td style="padding:8px 0;font-size:14px">${safeName}</td></tr>
          <tr><td style="padding:8px 0;color:#666;font-size:14px">Email</td>
              <td style="padding:8px 0;font-size:14px"><a href="mailto:${safeEmail}" style="color:#1A3C34">${safeEmail}</a></td></tr>
          ${safePhone ? `<tr><td style="padding:8px 0;color:#666;font-size:14px">Phone</td>
              <td style="padding:8px 0;font-size:14px">${safePhone}</td></tr>` : ''}
        </table>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="font-size:14px;color:#666;margin-bottom:8px">Message</p>
        <p style="font-size:15px;line-height:1.7;color:#333">${safeMessage}</p>
        <hr style="border:none;border-top:1px solid #eee;margin-top:32px">
        <p style="font-size:12px;color:#aaa;margin-top:16px">Sent from pilloto.com/contact — ${new Date().toUTCString()}</p>
      </div>`;

    await tenantLocalStorage.run(null, () =>
      sendEmail({
        to: CONTACT_EMAIL,
        subject: `[Pilloto] ${planLabel} inquiry from ${name.trim()}`,
        html,
        replyTo: email.trim(),
        _logMeta: { emailType: 'contact-form' },
      })
    );

    res.status(200).json({ success: true, message: "Message received. We'll be in touch soon." });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message. Please try again.' });
  }
});

export default router;
