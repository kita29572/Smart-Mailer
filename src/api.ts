import express from "express";
import nodemailer from "nodemailer";
import { db } from "./firebase";
import { doc, setDoc, updateDoc, collection, addDoc, serverTimestamp, deleteDoc, getDocs, query, where } from "firebase/firestore";

const app = express();
app.use(express.json());

// --- API Routes ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Smart Mailer API is active' });
});

// API Route for testing SMTP connection
app.post("/api/test-smtp", async (req, res) => {
  const { smtpConfig } = req.body;

  if (!smtpConfig) {
    return res.status(400).json({ error: "Missing SMTP configuration" });
  }

  const host = smtpConfig.host?.trim();
  const user = smtpConfig.user?.trim();
  const pass = smtpConfig.pass?.trim();
  const port = parseInt(smtpConfig.port);

  try {
    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: {
        user: user,
        pass: pass,
      },
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      },
      connectionTimeout: 10000
    });

    await transporter.verify();
    res.json({ success: true, message: "SMTP connection successful!" });
  } catch (error: any) {
    console.error("SMTP Verification Error:", error);
    res.status(500).json({ error: error.message || "SMTP connection failed" });
  }
});

// Start Background Campaign
app.post("/api/start-campaign", async (req, res) => {
  const { smtpConfig, emailData, recipients, campaignId, delay, uid } = req.body;

  if (!smtpConfig || !emailData || !recipients || !campaignId || !uid) {
    return res.status(400).json({ error: "Missing required campaign data" });
  }

  // Respond immediately
  res.json({ success: true, message: "Campaign started in background" });

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
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' }
    });

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      let emailTo = recipient;
      const match = recipient.match(/(.*)<(.*)>/);
      if (match) emailTo = match[2].trim();

      try {
        await transporter.sendMail({
          from: `"${smtpConfig.fromName || 'Smart Mailer'}" <${smtpConfig.fromEmail || user}>`,
          to: emailTo,
          subject: emailData.subject,
          text: emailData.text,
          html: emailData.html || emailData.text,
          headers: { 'X-Mailer': 'SmartMailer-v2.2' }
        });

        // Update History
        await addDoc(collection(db, "history"), {
          to: recipient,
          subject: emailData.subject,
          timestamp: Date.now(),
          status: "success",
          campaignId: campaignId,
          uid: uid
        });

      } catch (error: any) {
        console.error(`Failed to send to ${recipient}:`, error.message);
        await addDoc(collection(db, "history"), {
          to: recipient,
          subject: emailData.subject,
          timestamp: Date.now(),
          status: "failed",
          error: error.message,
          campaignId: campaignId,
          uid: uid
        });
      }

      // Update Campaign Progress
      await updateDoc(doc(db, "campaigns", campaignId), {
        currentIndex: i + 1,
        lastUpdated: serverTimestamp(),
        status: i + 1 === recipients.length ? "completed" : "running"
      });

      if (i < recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, (delay || 1) * 1000));
      }
    }
  })().catch(err => console.error("Background campaign error:", err));
});

// Delete Campaign
app.post("/api/delete-campaign", async (req, res) => {
  const { campaignId, uid } = req.body;
  if (!campaignId || !uid) return res.status(400).json({ error: "Missing data" });

  try {
    await deleteDoc(doc(db, "campaigns", campaignId));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete History Item
app.post("/api/delete-history", async (req, res) => {
  const { historyId, uid } = req.body;
  if (!historyId || !uid) return res.status(400).json({ error: "Missing data" });

  try {
    await deleteDoc(doc(db, "history", historyId));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Clear All History for User
app.post("/api/clear-history", async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).json({ error: "Missing UID" });

  try {
    const q = query(collection(db, "history"), where("uid", "==", uid));
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API Route for sending emails
app.post("/api/send-email", async (req, res) => {
  const { smtpConfig, emailData } = req.body;

  if (!smtpConfig || !emailData) {
    return res.status(400).json({ error: "Missing configuration or email data" });
  }

  const host = smtpConfig.host?.trim();
  const user = smtpConfig.user?.trim();
  const pass = smtpConfig.pass?.trim();
  const port = parseInt(smtpConfig.port);

  try {
    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: {
        user: user,
        pass: pass,
      },
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      }
    });

    const info = await transporter.sendMail({
      from: `"${smtpConfig.fromName || 'Smart Mailer'}" <${smtpConfig.fromEmail || user}>`,
      to: emailData.to,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html || emailData.text,
      headers: {
        'X-Mailer': 'SmartMailer-v2.2',
        'X-Priority': '3 (Normal)',
        'Importance': 'Normal'
      }
    });

    res.json({ success: true, messageId: info.messageId });
  } catch (error: any) {
    console.error("SMTP Error:", error);
    res.status(500).json({ error: error.message || "Failed to send email" });
  }
});

export default app;
