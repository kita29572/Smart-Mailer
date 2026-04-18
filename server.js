import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { initializeFirestore, doc, updateDoc, addDoc, collection, serverTimestamp, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase Config Defensively
const configPath = path.join(__dirname, 'firebase-applet-config.json');
let db = null;

try {
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const firebaseApp = initializeApp(firebaseConfig);
    db = initializeFirestore(firebaseApp, {
      experimentalForceLongPolling: true
    }, firebaseConfig.firestoreDatabaseId);
    console.log("Firebase initialized successfully with long-polling");
  } else {
    console.error("CRITICAL: firebase-applet-config.json not found! Database features will not work.");
  }
} catch (err) {
  console.error("Firebase initialization failed:", err.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Logging middleware for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// --- API Routes (MUST BE BEFORE STATIC FILES) ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Smart Mailer API is active' });
});

// Test SMTP Connection
app.post('/api/test-smtp', async (req, res) => {
  const { smtpConfig } = req.body;
  if (!smtpConfig) return res.status(400).json({ error: 'Missing SMTP configuration' });

  const host = smtpConfig.host?.trim();
  const user = smtpConfig.user?.trim();
  const pass = smtpConfig.pass?.trim();
  const port = parseInt(smtpConfig.port);

  try {
    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: { user: user, pass: pass },
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
      connectionTimeout: 10000
    });

    await transporter.verify();
    res.json({ success: true, message: 'SMTP connection successful!' });
  } catch (error) {
    console.error('SMTP Verification Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper: SpinTax Parser {option1|option2|option3}
function parseSpinTax(text) {
  if (!text) return text;
  return text.replace(/{([^{}]+)}/g, (match, options) => {
    const parts = options.split('|');
    return parts[Math.floor(Math.random() * parts.length)];
  });
}

// Helper: Process Email Content (SpinTax + Placeholders + Unsubscribe)
function processEmailContent(content, unsubscribeUrl, footerHtml, footerText, companyName) {
  if (!content) return { html: '', text: '' };
  
  // 1. First, apply SpinTax
  let processed = parseSpinTax(content);
  
  const year = new Date().getFullYear().toString();
  const date = new Date().toLocaleDateString();
  
  // 2. Handle Smart Placeholders with case-insensitive regex
  // We use a temporary token for the link to avoid it being replaced by the text version later
  const unsubscribeLink = `<a href="${unsubscribeUrl}" style="color: #4f46e5; text-decoration: underline; font-weight: 600;">Unsubscribe</a>`;
  
  processed = processed.replace(/{{unsubscribe}}/gi, unsubscribeLink);
  processed = processed.replace(/{{company}}/gi, companyName);
  processed = processed.replace(/{{year}}/gi, year);
  processed = processed.replace(/{{date}}/gi, date);
  
  // 3. Detect if unsubscribe was already included
  const hasUnsubscribe = /{{unsubscribe}}/i.test(content) || processed.includes(unsubscribeUrl);
  
  let finalHtml = processed;
  // Create plain text version by stripping common HTML tags if it was HTML
  let finalText = processed.replace(/<a href="([^"]+)"[^>]*>Unsubscribe<\/a>/gi, '$1');
  // Strip other common tags for final text version if needed, but here we assume 'content' might be plain text
  finalText = finalText.replace(/<br\s*\/?>/gi, '\n').replace(/<p>/gi, '').replace(/<\/p>/gi, '\n');

  // 4. Append footer if no unsubscribe link was found
  if (!hasUnsubscribe) {
    if (finalHtml.toLowerCase().includes('</body>')) {
      finalHtml = finalHtml.replace(/<\/body>/i, `${footerHtml}</body>`);
    } else {
      finalHtml += footerHtml;
    }
    finalText += footerText;
  }
  
  return { html: finalHtml, text: finalText };
}

// Helper: Get Professional Footer
function getProfessionalFooter(unsubscribeUrl, companyName) {
  const year = new Date().getFullYear();
  const footerText = `\n\n---\nYou are receiving this because you are on our list.\nUnsubscribe: ${unsubscribeUrl}`;
  const footerHtml = `
    <br><br>
    <div style="margin-top: 40px; padding-top: 25px; border-top: 1px solid #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; text-align: center; color: #6b7280; font-size: 12px; line-height: 1.6;">
      <p style="margin: 0 0 15px 0;">This email was sent to you because you've interacted with <strong>${companyName}</strong>.</p>
      
      <!-- Better Unsubscribe Button -->
      <div style="margin: 20px 0;">
        <a href="${unsubscribeUrl}" target="_blank" style="background-color: #111827; color: #ffffff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600; display: inline-block;">
          Unsubscribe from this list
        </a>
      </div>

      <p style="margin: 15px 0 0 0;">
        <a href="#" style="color: #6b7280; text-decoration: none;">Privacy Policy</a>
        <span style="margin: 0 12px; color: #d1d5db;">&bull;</span>
        <a href="#" style="color: #6b7280; text-decoration: none;">Manage Preferences</a>
      </p>
      <p style="margin: 15px 0 0 0; color: #9ca3af; font-size: 11px;">
        &copy; ${year} ${companyName}. Global HQ &bull; Built with Smart Mailer
      </p>
    </div>
  `;
  return { footerHtml, footerText };
}

// Helper: Get Anti-Spam Headers
function getAntiSpamHeaders(userEmail, unsubscribeUrl) {
  const messageId = `<${Math.random().toString(36).substring(2)}@${userEmail.split('@')[1] || 'smartmailer.app'}>`;
  const headers = {
    'X-Mailer': 'SmartMailer-Pro-v3.0',
    'X-Priority': '3 (Normal)',
    'Importance': 'Normal',
    'Precedence': 'bulk',
    'Message-ID': messageId,
    'Date': new Date().toUTCString()
  };

  if (unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>, <mailto:${userEmail}?subject=unsubscribe>`;
  } else {
    headers['List-Unsubscribe'] = `<mailto:${userEmail}?subject=unsubscribe>`;
  }

  return headers;
}

// Helper: Check if email is unsubscribed
async function isUnsubscribed(email, uid) {
  if (!db) return false;
  try {
    const q = query(collection(db, "unsubscribes"), where("email", "==", email.toLowerCase()), where("uid", "==", uid));
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (err) {
    console.error("Error checking unsubscribe status:", err);
    return false;
  }
}

// Start Background Campaign
app.post('/api/start-campaign', async (req, res) => {
  const { smtpConfig, emailData, recipients, campaignId, delay, uid } = req.body;
  
  if (!smtpConfig || !emailData || !recipients || !campaignId) {
    return res.status(400).json({ error: 'Missing required campaign data' });
  }

  // Determine base URL for unsubscribe links
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;

  // Respond immediately
  res.json({ success: true, message: 'Campaign started in background' });

  // Background Process
  (async () => {
    const host = smtpConfig.host?.trim();
    const user = smtpConfig.user?.trim();
    const pass = smtpConfig.pass?.trim();
    const port = parseInt(smtpConfig.port);

    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: { user: user, pass: pass },
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
      pool: true, 
      maxConnections: 5,
      maxMessages: 100
    });

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      let emailTo = recipient;
      const match = recipient.match(/(.*)<(.*)>/);
      if (match) emailTo = match[2].trim();

      // --- GDPR CHECK: Check if unsubscribed ---
      const optOut = await isUnsubscribed(emailTo, uid);
      if (optOut) {
        console.log(`Skipping unsubscribed user: ${emailTo}`);
        if (db) {
          await addDoc(collection(db, "history"), {
            to: recipient,
            subject: emailData.subject,
            timestamp: Date.now(),
            status: "skipped",
            reason: "unsubscribed",
            campaignId: campaignId,
            uid: uid
          });
        }
        continue;
      }

      // Generate Mandatory Unsubscribe Link (GDPR/CAN-SPAM Compliant)
      const encodedEmail = encodeURIComponent(Buffer.from(emailTo.toLowerCase()).toString('base64'));
      const unsubscribeUrl = `${baseUrl}/?page=unsubscribe&e=${encodedEmail}&u=${uid}`;
      const companyName = smtpConfig.fromName || 'Our Team';
      const { footerHtml, footerText } = getProfessionalFooter(unsubscribeUrl, companyName);

      // Process Content with SpinTax and Placeholders
      const finalSubject = parseSpinTax(emailData.subject);
      const contentResults = processEmailContent(emailData.html || emailData.text, unsubscribeUrl, footerHtml, footerText, companyName);
      const plainTextContent = processEmailContent(emailData.text, unsubscribeUrl, footerHtml, footerText, companyName).text;

      try {
        await transporter.sendMail({
          from: `"${companyName}" <${smtpConfig.fromEmail || user}>`,
          to: emailTo,
          subject: finalSubject,
          text: plainTextContent,
          html: contentResults.html,
          headers: getAntiSpamHeaders(smtpConfig.fromEmail || user, unsubscribeUrl)
        });

        if (db) {
          await addDoc(collection(db, "history"), {
            to: recipient,
            subject: finalSubject,
            timestamp: Date.now(),
            status: "success",
            campaignId: campaignId,
            uid: uid
          });
        }
      } catch (error) {
        console.error(`Failed to send to ${recipient}:`, error.message);
        if (db) {
          await addDoc(collection(db, "history"), {
            to: recipient,
            subject: finalSubject,
            timestamp: Date.now(),
            status: "failed",
            error: error.message,
            campaignId: campaignId,
            uid: uid
          });
        }
      }

      if (db) {
        await updateDoc(doc(db, "campaigns", campaignId), {
          currentIndex: i + 1,
          lastUpdated: serverTimestamp(),
          status: i + 1 === recipients.length ? "completed" : "running"
        });
      }

      if (i < recipients.length - 1) {
        // Add a small random jitter to the delay to look more "human"
        const jitter = Math.random() * 2; 
        const finalDelay = ((delay || 1) + jitter) * 1000;
        await new Promise(resolve => setTimeout(resolve, finalDelay));
      }
    }
    transporter.close();
  })().catch(err => console.error("Background campaign error:", err));
});

// Delete Campaign
app.post('/api/delete-campaign', async (req, res) => {
  const { campaignId, uid } = req.body;
  try {
    await deleteDoc(doc(db, "campaigns", campaignId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete History Item
app.post('/api/delete-history', async (req, res) => {
  const { historyId, uid } = req.body;
  try {
    await deleteDoc(doc(db, "history", historyId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear All History for User
app.post('/api/clear-history', async (req, res) => {
  const { uid } = req.body;
  try {
    const q = query(collection(db, "history"), where("uid", "==", uid));
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Direct Unsubscribe API for Frontend
app.post('/api/unsubscribe-direct', async (req, res) => {
  const { email, uid } = req.body;
  if (!email || !uid) return res.status(400).json({ error: 'Missing data' });
  
  try {
    const cleanEmail = email.toLowerCase().trim();
    if (db) {
      const q = query(collection(db, "unsubscribes"), where("email", "==", cleanEmail), where("uid", "==", uid));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        await addDoc(collection(db, "unsubscribes"), {
          email: cleanEmail,
          uid: uid,
          unsubscribedAt: serverTimestamp(),
          source: 'link_frontend'
        });
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unsubscribe Route (GDPR Mandatory)
app.get('/api/unsubscribe', async (req, res) => {
  const { e, u } = req.query;
  if (!e || !u) {
    return res.status(400).send('<h1>Invalid Unsubscribe Request</h1><p>The link seems to be broken.</p>');
  }

  try {
    const email = Buffer.from(e, 'base64').toString('utf8').toLowerCase();
    
    if (db) {
      console.log(`Processing unsubscribe for: ${email} (UID: ${u})`);
      // Check if already unsubscribed
      const q = query(collection(db, "unsubscribes"), where("email", "==", email), where("uid", "==", u));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        await addDoc(collection(db, "unsubscribes"), {
          email: email,
          uid: u,
          unsubscribedAt: serverTimestamp(),
          source: 'link'
        });
      }
    }

    // Return a nice confirmation page
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Unsubscribe Confirmed</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            color: #334155; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            height: 100vh; 
            margin: 0; 
          }
          .card { 
            background: white; 
            padding: 48px 32px; 
            border-radius: 24px; 
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); 
            text-align: center; 
            max-width: 440px; 
            width: 90%;
            border: 1px solid rgba(255,255,255,0.8);
          }
          .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 6px 12px;
            background: #ecfdf5;
            color: #10b981;
            border-radius: 99px;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 24px;
          }
          .icon-container { 
            width: 80px;
            height: 80px;
            background: #f0f9ff;
            color: #0ea5e9;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 40px; 
            margin: 0 auto 24px; 
            box-shadow: 0 0 0 10px #f8fafc;
          }
          h1 { 
            color: #1e293b; 
            font-size: 24px;
            font-weight: 700;
            margin: 0 0 16px 0; 
            tracking: -0.025em;
          }
          p { 
            line-height: 1.6; 
            color: #64748b; 
            font-size: 15px;
            margin-bottom: 24px;
          }
          .email-box {
            background: #f8fafc;
            padding: 12px;
            border-radius: 12px;
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 32px;
            border: 1px solid #e2e8f0;
          }
          .footer {
            font-size: 13px;
            color: #94a3b8;
            border-top: 1px solid #f1f5f9;
            padding-top: 24px;
          }
          .button {
            display: inline-block;
            background: #1e293b;
            color: white;
            padding: 12px 24px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.2s;
          }
          .button:hover {
            background: #0f172a;
            transform: translateY(-1px);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="status-badge">Action Confirmed</div>
          <div class="icon-container">✉️</div>
          <h1>Successfully Unsubscribed</h1>
          <p>We've received your request. You will no longer receive marketing communications at:</p>
          <div class="email-box">${email}</div>
          <p>It may take up to 24 hours for all our systems to update, though it is usually immediate.</p>
          <div class="footer">
            <p>If this was an accident or you'd like to reach out to us for any other reason, please contact our support team.</p>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Unsubscribe Error:", error);
    res.status(500).send('<h1>Error Processing Request</h1><p>We could not process your unsubscription at this time.</p>');
  }
});

// Send Single Email
app.post('/api/send-email', async (req, res) => {
  const { smtpConfig, emailData, uid } = req.body;
  const host = smtpConfig.host?.trim();
  const user = smtpConfig.user?.trim();
  const pass = smtpConfig.pass?.trim();
  const port = parseInt(smtpConfig.port);

  try {
    // GDPR CHECK
    const optOut = await isUnsubscribed(emailData.to, uid);
    if (optOut) {
      return res.status(400).json({ error: "Cannot send. This user has unsubscribed from your list." });
    }

    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: { user: user, pass: pass },
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' }
    });

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const reqHost = req.get('host');
    const baseUrl = `${protocol}://${reqHost}`;
    const encodedEmail = encodeURIComponent(Buffer.from(emailData.to.toLowerCase()).toString('base64'));
    const unsubscribeUrl = `${baseUrl}/?page=unsubscribe&e=${encodedEmail}&u=${uid}`;
    const companyName = smtpConfig.fromName || 'Our Team';
    const { footerHtml, footerText } = getProfessionalFooter(unsubscribeUrl, companyName);

    // Process Content
    const finalSubject = parseSpinTax(emailData.subject);
    const contentResults = processEmailContent(emailData.html || emailData.text, unsubscribeUrl, footerHtml, footerText, companyName);
    const plainTextContent = processEmailContent(emailData.text, unsubscribeUrl, footerHtml, footerText, companyName).text;

    const info = await transporter.sendMail({
      from: `"${companyName}" <${smtpConfig.fromEmail || user}>`,
      to: emailData.to,
      subject: finalSubject,
      text: plainTextContent,
      html: contentResults.html,
      headers: getAntiSpamHeaders(smtpConfig.fromEmail || user, unsubscribeUrl)
    });

    res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Static Files ---
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
} else {
  console.warn("Warning: 'dist' directory not found. Static files will not be served.");
}

// Catch-all route to serve the frontend
app.get('*', (req, res) => {
  // If an API route was requested but not found, return a JSON error instead of HTML
  if (req.url.startsWith('/api/') || req.url.includes('/api/')) {
    console.log(`404 API Route Not Found: ${req.url}`);
    return res.status(404).json({ 
      error: `API route ${req.url} not found.`,
      suggestion: "Check if the API route is correctly defined in server.js and that the request URL is correct."
    });
  }
  
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Frontend not found. Please run 'npm run build' and ensure the 'dist' folder exists.");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
