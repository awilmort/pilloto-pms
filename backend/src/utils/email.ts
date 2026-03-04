import nodemailer from 'nodemailer';
import axios from 'axios';

// Email via Microsoft Graph API (preferred when configured)
const isGraphConfigured = () => (
  !!process.env.GRAPH_TENANT_ID &&
  !!process.env.GRAPH_CLIENT_ID &&
  !!process.env.GRAPH_CLIENT_SECRET &&
  !!(process.env.GRAPH_SENDER_UPN || process.env.EMAIL_USER || process.env.EMAIL_FROM)
);

const getGraphAccessToken = async (): Promise<string> => {
  const tenantId = process.env.GRAPH_TENANT_ID!;
  const clientId = process.env.GRAPH_CLIENT_ID!;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET!;

  const form = new URLSearchParams();
  form.append('client_id', clientId);
  form.append('client_secret', clientSecret);
  form.append('grant_type', 'client_credentials');
  form.append('scope', 'https://graph.microsoft.com/.default');

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const resp = await axios.post(tokenUrl, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return resp.data.access_token as string;
};

const sendEmailViaGraph = async (options: EmailOptions): Promise<void> => {
  const accessToken = await getGraphAccessToken();
  const sender = process.env.GRAPH_SENDER_UPN || process.env.EMAIL_USER || process.env.EMAIL_FROM!;

  const bodyContent = options.html || options.text || '';
  const contentType = options.html ? 'HTML' : 'Text';

  const payload = {
    message: {
      subject: options.subject,
      body: {
        contentType,
        content: bodyContent
      },
      from: { emailAddress: { address: process.env.GRAPH_SENDER_UPN } },
      toRecipients: [
        { emailAddress: { address: options.to } }
      ],
      // Optional reply-to
      replyTo: process.env.EMAIL_FROM ? [{ emailAddress: { address: process.env.EMAIL_FROM } }] : undefined
    },
    saveToSentItems: false
  };

  // Application permissions: send as specific user
  const url = `https://graph.microsoft.com/v1.0/users/${sender}/sendMail`;
  await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
};

// SMTP transporter fallback (development/local testing)
const createSmtpTransporter = () => {
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = (process.env.EMAIL_SECURE === 'true') || port === 465;
  const user = process.env.EMAIL_USER || process.env.EMAIL_FROM;
  const pass = process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;

  if (host && user && pass) {
    return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Email service is not configured. Set Microsoft Graph env or SMTP env variables.');
  }

  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER || 'test@ethereal.email',
      pass: process.env.EMAIL_PASS || 'test123'
    }
  });
};

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    if (isGraphConfigured()) {
      await sendEmailViaGraph(options);
      return;
    }

    // Fallback to SMTP (dev/local)
    const transporter = createSmtpTransporter();
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@pilloto.com',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text
    });
    if (process.env.NODE_ENV === 'development') {
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('Email send error:', error);
    throw new Error('Email could not be sent');
  }
};

export const sendVerificationEmail = async (user: any, token: string): Promise<void> => {
  const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
    <title>Verifica tu correo electrónico - Pilloto</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #f8f9fa; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #fff; padding: 30px; border: 1px solid #e9ecef; }
            .footer { background: #f8f9fa; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
            .btn { display: inline-block; padding: 12px 24px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .btn:hover { background: #218838; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
        <h1>Verifica tu dirección de correo</h1>
            </div>
            <div class="content">
        <h2>Hola ${user.firstName},</h2>
        <p>Por favor verifica tu correo electrónico haciendo clic en el botón de abajo:</p>
        <p>Esto confirma que eres el propietario del correo y podrás usarlo de forma segura en tu cuenta.</p>
                
                <div style="text-align: center;">
          <a href="${verifyUrl}" class="btn">Verificar correo electrónico</a>
                </div>
                
        <p>Si el botón no funciona, puedes copiar y pegar el siguiente enlace en tu navegador:</p>
                <p style="word-break: break-all; background: #f8f9fa; padding: 10px; border-radius: 4px;">${verifyUrl}</p>
                
        <p><strong>Importante:</strong> Este enlace de verificación expirará en 24 horas.</p>
                
        <p>Si no solicitaste esto, por favor ignora este correo.</p>
                
        <p>Saludos cordiales,<br>El equipo de Pilloto</p>
            </div>
            <div class="footer">
        <p>&copy; 2024 Pilloto. Todos los derechos reservados.</p>
            </div>
        </div>
    </body>
    </html>
  `;

  const text = `
  Verifica tu correo electrónico - Pilloto
    
  Hola ${user.firstName},
    
  Por favor verifica tu correo visitando el siguiente enlace:
    
  ${verifyUrl}
    
  Este enlace de verificación expirará en 24 horas.
    
  Si no solicitaste esto, por favor ignora este correo.
    
  Saludos cordiales,
  El equipo de Pilloto
  `;

  await sendEmail({
    to: user.pendingEmail || user.email,
  subject: 'Verifica tu correo electrónico - Pilloto',
    html,
    text
  });
};

export const sendPasswordResetEmail = async (user: any, token: string): Promise<void> => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
    <title>Restablecer contraseña - Pilloto</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #f8f9fa; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #fff; padding: 30px; border: 1px solid #e9ecef; }
            .footer { background: #f8f9fa; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
            .btn { display: inline-block; padding: 12px 24px; background: #dc3545; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .btn:hover { background: #c82333; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
        <h1>Solicitud de restablecimiento de contraseña</h1>
            </div>
            <div class="content">
        <h2>Hola ${user.firstName},</h2>
        <p>Has solicitado restablecer la contraseña de tu cuenta de Pilloto. Haz clic en el botón para restablecerla:</p>
                
                <div style="text-align: center;">
          <a href="${resetUrl}" class="btn">Restablecer contraseña</a>
                </div>
                
        <p>Si el botón no funciona, puedes copiar y pegar el siguiente enlace en tu navegador:</p>
                <p style="word-break: break-all; background: #f8f9fa; padding: 10px; border-radius: 4px;">${resetUrl}</p>
                
        <p><strong>Importante:</strong> Este enlace de restablecimiento expirará en 1 hora por razones de seguridad.</p>
                
        <p>Si no solicitaste el restablecimiento, por favor ignora este correo. Tu contraseña permanecerá sin cambios.</p>
                
        <p>Saludos cordiales,<br>El equipo de Pilloto</p>
            </div>
            <div class="footer">
        <p>&copy; 2024 Pilloto. Todos los derechos reservados.</p>
            </div>
        </div>
    </body>
    </html>
  `;

  const text = `
  Solicitud de restablecimiento de contraseña
    
  Hola ${user.firstName},
    
  Has solicitado restablecer la contraseña de tu cuenta de Pilloto. Visita el siguiente enlace para restablecerla:
    
  ${resetUrl}
    
  Este enlace expirará en 1 hora por razones de seguridad.
    
  Si no solicitaste el restablecimiento, por favor ignora este correo.
    
  Saludos cordiales,
  El equipo de Pilloto
  `;

  await sendEmail({
    to: user.email,
  subject: 'Solicitud de restablecimiento de contraseña - Pilloto',
    html,
    text
  });
};

export const sendReservationConfirmationEmail = async (reservation: any): Promise<void> => {
  const reservationUrl = `${process.env.FRONTEND_URL}/reservation/code/${reservation.reservationCode}`;
  const currentYear = new Date().getFullYear();

  // Determine guest name: prefer reservation.guestName, then user, else generic
  const guestName = (reservation.guestName && reservation.guestName.firstName && reservation.guestName.lastName)
    ? `${reservation.guestName.firstName} ${reservation.guestName.lastName}`
    : (reservation.user ? `${reservation.user.firstName} ${reservation.user.lastName}` : 'Huésped');

  const firstName = (reservation.guestName && reservation.guestName.firstName)
    ? reservation.guestName.firstName
    : (reservation.user ? reservation.user.firstName : 'Huésped');

  // Format dates
  const checkInDate = new Date(reservation.checkInDate).toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const checkOutDate = reservation.checkOutDate 
    ? new Date(reservation.checkOutDate).toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : null;

  // Build reservation details based on type
  let reservationDetails = '';
  let reservationTypeLabel = '';

  if (reservation.type === 'room') {
    reservationTypeLabel = 'Reserva de habitación';
    reservationDetails = `
      <p><strong>Check-in:</strong> ${checkInDate}</p>
      <p><strong>Check-out:</strong> ${checkOutDate}</p>
      <p><strong>Noches:</strong> ${reservation.totalNights}</p>
    `;
  } else if (reservation.type === 'daypass') {
    reservationTypeLabel = 'Reserva Day Pass';
    reservationDetails = `
      <p><strong>Fecha de visita:</strong> ${checkInDate}</p>
    `;
  } else if (reservation.type === 'event') {
    reservationTypeLabel = 'Reserva de evento';
    reservationDetails = `
      <p><strong>Tipo de evento:</strong> ${reservation.eventType ? (reservation.eventType.charAt(0).toUpperCase() + reservation.eventType.slice(1)) : 'Evento'}</p>
      <p><strong>Fecha del evento:</strong> ${checkInDate}</p>
      ${checkOutDate ? `<p><strong>Fecha de finalización:</strong> ${checkOutDate}</p>` : ''}
      <p><strong>Asistentes esperados:</strong> ${reservation.expectedAttendees || reservation.guests}</p>
      <p><strong>Descripción:</strong> ${reservation.eventDescription || 'N/D'}</p>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Confirmación de reserva - Pilloto</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #28a745; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #fff; padding: 30px; border: 1px solid #e9ecef; }
            .footer { background: #f8f9fa; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
            .btn { display: inline-block; padding: 12px 24px; background: #28a745; color: #ffffff !important; text-decoration: none !important; border-radius: 5px; margin: 20px 10px; cursor: pointer; }
            .btn-cancel { background: #dc3545; color: #ffffff !important; }
            .btn:hover { opacity: 0.9; }
            .summary-box { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .total-price { font-size: 24px; color: #28a745; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>✓ ¡Reserva confirmada!</h1>
            </div>
            <div class="content">
                <h2>Hola ${firstName},</h2>
                <p>¡Gracias por elegir Pilloto! Tu ${reservationTypeLabel.toLowerCase()} ha sido confirmada.</p>
                
                <div class="summary-box">
                    <h3>${reservationTypeLabel}</h3>
                    ${reservationDetails}
                    <p><strong>Nombre del huésped:</strong> ${guestName}</p>
                    <p><strong>Huéspedes:</strong> ${reservation.guestDetails.adults} Adultos, ${reservation.guestDetails.children} Niños, ${reservation.guestDetails.infants} Bebés</p>
                    <p><strong>Contacto:</strong> ${reservation.contactInfo.email} | ${reservation.contactInfo.phone}</p>
                    ${reservation.specialRequests ? `<p><strong>Solicitudes especiales:</strong> ${reservation.specialRequests}</p>` : ''}
                    <hr>
                    <p class="total-price">Total: $${reservation.totalPrice.toFixed(2)}</p>
                    <p><strong>Estado:</strong> ${reservation.status.charAt(0).toUpperCase() + reservation.status.slice(1)}</p>
                    ${reservation.reservationCode ? `<p><strong>Código de reserva:</strong> ${reservation.reservationCode}</p>` : ''}
                </div>
                
                <div style="text-align: center;">
                  <a href="${reservationUrl}" class="btn" style="color:#ffffff !important;" target="_blank" rel="noopener noreferrer">Ver reserva</a>
                </div>
                
                <p><strong>Información importante:</strong></p>
                <ul>
                    <li>Por favor llega a la hora de check-in especificada</li>
                    <li>Lleva una identificación válida para el check-in</li>
                    <li>Las cancelaciones deben realizarse al menos con 24 horas de anticipación</li>
                    <li>Contáctanos en info@pilloto.com para cualquier pregunta</li>
                </ul>
                
                <p>¡Esperamos darte la bienvenida en Pilloto!</p>
                
                <p>Saludos cordiales,<br>El equipo de Pilloto</p>
            </div>
            <div class="footer">
              <p>&copy; ${currentYear} Pilloto. Todos los derechos reservados.</p>
                <p>¿Necesitas ayuda? Contáctanos en info@pilloto.com o llama al +1-234-567-8900</p>
            </div>
        </div>
    </body>
    </html>
  `;

  const text = `
    Reserva confirmada - Pilloto
    
    Hola ${firstName},
    
    ¡Gracias por elegir Pilloto! Tu ${reservationTypeLabel.toLowerCase()} ha sido confirmada.
    
    RESUMEN DE LA RESERVA
    ----------------------
    ${reservationTypeLabel}
    ${reservation.type === 'room' ? `Check-in: ${checkInDate}\nCheck-out: ${checkOutDate}\nNoches: ${reservation.totalNights}` : ''}
    ${reservation.type === 'daypass' ? `Fecha de visita: ${checkInDate}` : ''}
    ${reservation.type === 'event' ? `Tipo de evento: ${reservation.eventType}\nFecha del evento: ${checkInDate}\nAsistentes esperados: ${reservation.expectedAttendees || reservation.guests}` : ''}
    
    Nombre del huésped: ${guestName}
    Huéspedes: ${reservation.guestDetails.adults} Adultos, ${reservation.guestDetails.children} Niños, ${reservation.guestDetails.infants} Bebés
    Contacto: ${reservation.contactInfo.email} | ${reservation.contactInfo.phone}
    
    Total: $${reservation.totalPrice.toFixed(2)}
    Estado: ${reservation.status.charAt(0).toUpperCase() + reservation.status.slice(1)}
    ${reservation.reservationCode ? `Código de reserva: ${reservation.reservationCode}` : ''}
    
    Ver tu reserva:
    ${reservationUrl}
    
    INFORMACIÓN IMPORTANTE:
    - Por favor llega a la hora de check-in especificada
    - Lleva una identificación válida para el check-in
    - Las cancelaciones deben realizarse al menos con 24 horas de anticipación
    - Contáctanos en info@pilloto.com para cualquier pregunta
    
    ¡Esperamos darte la bienvenida en Pilloto!
    
    Saludos cordiales,
    El equipo de Pilloto
  `;

  await sendEmail({
    to: reservation.contactInfo.email,
    subject: `Reserva confirmada - Pilloto (${reservation.reservationCode || 'CONFIRMADA'})`,
    html,
    text
  });
};
