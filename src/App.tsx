import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Mail, 
  Settings, 
  Send, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Eye, 
  EyeOff,
  History,
  Trash2,
  Copy,
  Users,
  Clock,
  Code,
  FileText,
  Play,
  Pause,
  StopCircle,
  Plus,
  Smartphone,
  Tablet,
  Monitor,
  Layout,
  Layers,
  ChevronRight,
  Save,
  Upload,
  RotateCcw,
  BarChart3,
  MousePointer2,
  UserX,
  Ban,
  LogOut,
  LogIn
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Toaster, toast } from "sonner";
import { GoogleGenAI } from "@google/genai";
import { db, auth } from "./firebase";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged, 
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword
} from "firebase/auth";
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  doc, 
  setDoc, 
  serverTimestamp,
  getDocs,
  where,
  limit,
  deleteDoc,
  getDocFromServer
} from "firebase/firestore";

// Types
interface SMTPConfig {
  id: string;
  name: string;
  host: string;
  port: string;
  user: string;
  pass: string;
  secure: boolean;
  fromName: string;
  fromEmail: string;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  content: string;
  isCustom?: boolean;
}

interface EmailData {
  to: string;
  subject: string;
  text: string;
  html?: string;
  isHtml: boolean;
}

interface SentEmail {
  id: string;
  to: string;
  subject: string;
  timestamp: number;
  status: "success" | "failed";
}

interface CampaignState {
  id: string;
  name: string;
  isActive: boolean;
  isPaused: boolean;
  currentIndex: number;
  total: number;
  recipients: string[];
  delay: number; // in seconds
  logs: string[];
  smtpConfig: SMTPConfig;
  emailData: EmailData;
  createdAt: number;
}

interface EmailGroup {
  id: string;
  name: string;
  emails: string[];
}

// Helper to extract and clean emails from any text
const extractEmails = (text: string): string[] => {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex);
  if (!matches) return [];
  // Remove duplicates and trim
  return Array.from(new Set(matches.map(email => email.toLowerCase().trim())));
};

const formatEmailsForDisplay = (emails: string[]): string => {
  return emails.join(", ");
};

export default function App() {
  // CRITICAL: Test Connection to Firestore
  useEffect(() => {
    async function testConnection() {
      try {
        if (!db) return;
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error: any) {
        if (error.message.includes('the client is offline') || error.message.includes('insufficient permissions')) {
          console.error("Firestore connection issue:", error);
        }
      }
    }
    testConnection();
  }, []);

  // State
  const [smtpProfiles, setSmtpProfiles] = useState<SMTPConfig[]>(() => {
    const saved = localStorage.getItem("smtp_profiles");
    if (saved) return JSON.parse(saved);
    
    // Migrate old single config if exists
    const old = localStorage.getItem("smtp_config");
    if (old) {
      const parsed = JSON.parse(old);
      return [{ ...parsed, id: "default", name: "Default Profile" }];
    }
    
    return [{
      id: "default",
      name: "Default Profile",
      host: "",
      port: "587",
      user: "",
      pass: "",
      secure: false,
      fromName: "Smart Mailer",
      fromEmail: ""
    }];
  });

  const [selectedSmtpId, setSelectedSmtpId] = useState<string>(() => {
    return localStorage.getItem("selected_smtp_id") || "default";
  });

  const activeSmtp = smtpProfiles.find(p => p.id === selectedSmtpId) || smtpProfiles[0];

  useEffect(() => {
    localStorage.setItem("smtp_profiles", JSON.stringify(smtpProfiles));
  }, [smtpProfiles]);

  useEffect(() => {
    localStorage.setItem("selected_smtp_id", selectedSmtpId);
  }, [selectedSmtpId]);

  const [emailData, setEmailData] = useState<EmailData>({
    to: "",
    subject: "",
    text: "",
    html: "",
    isHtml: false
  });

  const [bulkRecipients, setBulkRecipients] = useState("");
  const [campaignDelay, setCampaignDelay] = useState(5); // Default 5 seconds
  const [campaign, setCampaign] = useState<CampaignState>({
    isActive: false,
    isPaused: false,
    currentIndex: 0,
    total: 0,
    recipients: [],
    delay: 5,
    logs: []
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const emails = extractEmails(text);
      if (emails.length > 0) {
        setBulkRecipients(formatEmailsForDisplay(emails));
        toast.success(`Extracted ${emails.length} valid emails!`);
      } else {
        toast.error("No valid emails found in file");
      }
    };
    reader.readAsText(file);
  };

  const [isSending, setIsSending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [previewDevice, setPreviewDevice] = useState<"mobile" | "tablet" | "desktop">("desktop");
  const [unsubscribeContext, setUnsubscribeContext] = useState<{ email: string, uid: string } | null>(null);
  const [isUnsubscribedDone, setIsUnsubscribedDone] = useState(false);
  const [isUnsubscribingProcess, setIsUnsubscribingProcess] = useState(false);
  const [testUnsubEmail, setTestUnsubEmail] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('page') === 'unsubscribe') {
      const e = params.get('e');
      const u = params.get('u');
      if (e && u) {
        try {
          // URLSearchParams.get correctly decodes URI components, 
          // but we still need to handle potential base64 issues
          const decodedEmail = atob(e);
          setUnsubscribeContext({ email: decodedEmail, uid: u });
        } catch (err) {
          console.error("Invalid unsubscribe parameters", err);
        }
      }
    }
  }, []);

  const handleDirectUnsubscribe = async () => {
    if (!unsubscribeContext) return;
    setIsUnsubscribingProcess(true);
    try {
      const res = await fetch('/api/unsubscribe-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: unsubscribeContext.email,
          uid: unsubscribeContext.uid
        })
      });
      const data = await res.json();
      if (data.success) {
        setIsUnsubscribedDone(true);
        toast.success("Successfully unsubscribed");
      }
    } catch (err) {
      toast.error("Failed to process request");
    } finally {
      setIsUnsubscribingProcess(false);
    }
  };

  const handleCopyTestUnsubLink = () => {
    if (!testUnsubEmail || !user) return;
    try {
      const encoded = btoa(testUnsubEmail.toLowerCase());
      const url = `${window.location.origin}/?page=unsubscribe&e=${encodeURIComponent(encoded)}&u=${user.uid}`;
      navigator.clipboard.writeText(url);
      toast.success("Live test link copied to clipboard!");
    } catch (err) {
      toast.error("Generation failed");
    }
  };
  
  const [manualUnsubscribeEmail, setManualUnsubscribeEmail] = useState("");
  const [isAddingUnsubscribe, setIsAddingUnsubscribe] = useState(false);

  const handleAddManualUnsubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !manualUnsubscribeEmail) return;
    
    setIsAddingUnsubscribe(true);
    try {
      const email = manualUnsubscribeEmail.toLowerCase().trim();
      const q = query(collection(db, "unsubscribes"), where("email", "==", email), where("uid", "==", user.uid));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        await setDoc(doc(collection(db, "unsubscribes")), {
          email,
          uid: user.uid,
          unsubscribedAt: serverTimestamp(),
          source: 'manual'
        });
        toast.success(`${email} added to opt-out list`);
        setManualUnsubscribeEmail("");
      } else {
        toast.error("Email is already in the opt-out list");
      }
    } catch (error: any) {
      toast.error("Failed to add to opt-out list");
      console.error(error);
    } finally {
      setIsAddingUnsubscribe(false);
    }
  };

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [loginEmail, setLoginEmail] = useState("ah2190080@gmail.com");
  const [loginPassword, setLoginPassword] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showProfileModal, setShowProfileModal] = useState(false);

  const [history, setHistory] = useState<SentEmail[]>([]);
  const [unsubscribes, setUnsubscribes] = useState<any[]>([]);
  const [showUnsubscribes, setShowUnsubscribes] = useState(false);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }
    const q = query(collection(db, "history"), where("uid", "==", user.uid), orderBy("timestamp", "desc"), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SentEmail[];
      setHistory(data);
    }, (error) => {
      console.error("History listener error:", error);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnsubscribes([]);
      return;
    }
    const q = query(collection(db, "unsubscribes"), where("uid", "==", user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setUnsubscribes(data);
    }, (error) => {
      console.error("Unsubscribe listener error:", error);
    });
    return () => unsubscribe();
  }, [user]);

  const handleRemoveUnsubscribe = async (id: string) => {
    try {
      if (!db) return;
      await deleteDoc(doc(db, "unsubscribes", id));
      toast.success("Restriction removed for this email");
    } catch (error: any) {
      toast.error("Failed to remove restriction");
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      toast.error("Please enter both email and password");
      return;
    }
    setIsLoggingIn(true);
    try {
      if (isSigningUp) {
        await createUserWithEmailAndPassword(auth, loginEmail, loginPassword);
        toast.success("Account created successfully!");
      } else {
        await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
        toast.success("Logged in successfully!");
      }
    } catch (error: any) {
      toast.error((isSigningUp ? "Sign up" : "Login") + " failed: " + error.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!loginEmail) {
      toast.error("Please enter your email address");
      return;
    }
    setIsResetting(true);
    try {
      await sendPasswordResetEmail(auth, loginEmail);
      toast.success("Password reset email sent! Check your inbox.");
    } catch (error: any) {
      toast.error("Failed to send reset email: " + error.message);
    } finally {
      setIsResetting(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    try {
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        toast.success("Password updated successfully!");
        setNewPassword("");
        setShowProfileModal(false);
      }
    } catch (error: any) {
      toast.error("Failed to update password: " + error.message);
    }
  };

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      toast.success("Logged in successfully!");
    } catch (error: any) {
      if (error.code === "auth/cancelled-popup-request") {
        toast.info("Login popup was closed or replaced. Please try again.");
      } else if (error.code === "auth/popup-closed-by-user") {
        toast.info("Login window was closed. Please try again.");
      } else {
        toast.error("Login failed: " + error.message);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success("Logged out!");
    } catch (error: any) {
      toast.error("Logout failed");
    }
  };

  // Analytics State
  const [campaigns, setCampaigns] = useState<any[]>([]);

  useEffect(() => {
    if (!user) {
      setCampaigns([]);
      return;
    }
    const q = query(collection(db, "campaigns"), where("uid", "==", user.uid), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCampaigns(data);
    }, (error) => {
      console.error("Campaigns listener error:", error);
    });
    return () => unsubscribe();
  }, [user]);

  // Active Campaigns State (Concurrent)
  const [activeCampaigns, setActiveCampaigns] = useState<CampaignState[]>([]);

  const [groups, setGroups] = useState<EmailGroup[]>(() => {
    const saved = localStorage.getItem("email_groups");
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [newGroupName, setNewGroupName] = useState("");

  const [customTemplates, setCustomTemplates] = useState<EmailTemplate[]>(() => {
    const saved = localStorage.getItem("custom_templates");
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem("custom_templates", JSON.stringify(customTemplates));
  }, [customTemplates]);

  useEffect(() => {
    localStorage.setItem("email_groups", JSON.stringify(groups));
  }, [groups]);

  const handleAddGroup = () => {
    if (!newGroupName.trim()) return;
    const newGroup: EmailGroup = {
      id: Math.random().toString(36).substr(2, 9),
      name: newGroupName,
      emails: []
    };
    setGroups([...groups, newGroup]);
    setNewGroupName("");
    toast.success(`Group "${newGroup.name}" created!`);
  };

  const handleDeleteGroup = (id: string) => {
    setGroups(groups.filter(g => g.id !== id));
    toast.success("Group deleted");
  };

  const handleDeleteEmailFromGroup = (groupId: string, email: string) => {
    setGroups(groups.map(g => {
      if (g.id === groupId) {
        return { ...g, emails: g.emails.filter(e => e !== email) };
      }
      return g;
    }));
    toast.success(`Removed ${email} from group`);
  };

  const handleAddEmailsToGroup = (groupId: string) => {
    const recipients = extractEmails(bulkRecipients);
    if (recipients.length === 0) {
      toast.error("No valid emails to add");
      return;
    }
    setGroups(groups.map(g => {
      if (g.id === groupId) {
        const uniqueEmails = Array.from(new Set([...g.emails, ...recipients]));
        return { ...g, emails: uniqueEmails };
      }
      return g;
    }));
    toast.success(`Added ${recipients.length} emails to group`);
  };

  const handleGroupFileUpload = (groupId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const emails = extractEmails(text);
      
      if (emails.length === 0) {
        toast.error("No valid emails found in file");
        return;
      }

      setGroups(groups.map(g => {
        if (g.id === groupId) {
          const uniqueEmails = Array.from(new Set([...g.emails, ...emails]));
          return { ...g, emails: uniqueEmails };
        }
        return g;
      }));
      toast.success(`Imported ${emails.length} emails to group`);
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = "";
  };

  const loadGroup = (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (group) {
      setBulkRecipients(group.emails.join("\n"));
      toast.success(`Loaded ${group.emails.length} emails from ${group.name}`);
    }
  };

  const renderPreview = (id?: string) => {
    const deviceWidths = {
      mobile: "375px",
      tablet: "768px",
      desktop: "100%"
    };

    // --- PREVIEW SIMULATION (Matches Server Logic) ---
    const simulateProcessing = (content: string, isHtml: boolean) => {
      if (!content) return "No content to preview";
      
      // 1. Simulate SpinTax
      let processed = content.replace(/{([^{}]+)}/g, (match, options) => {
        const parts = options.split('|');
        return parts[0]; // Just take first option for preview
      });

      const year = new Date().getFullYear().toString();
      const date = new Date().toLocaleDateString();
      const companyName = activeSmtp?.fromName || "Your Company";
      const unsubscribeUrl = "#unsubscribe-preview";

      // 2. Handle Smart Placeholders
      const unsubscribeLink = `<a href="${unsubscribeUrl}" style="color: #4f46e5; text-decoration: underline; font-weight: 600;">Unsubscribe</a>`;
      processed = processed.replace(/{{unsubscribe}}/gi, isHtml ? unsubscribeLink : unsubscribeUrl);
      processed = processed.replace(/{{company}}/gi, companyName);
      processed = processed.replace(/{{year}}/gi, year);
      processed = processed.replace(/{{date}}/gi, date);

      // 3. Append Footer if missing
      const hasUnsubscribe = /{{unsubscribe}}/i.test(content) || content.includes(unsubscribeUrl);
      if (!hasUnsubscribe) {
        const footerHtml = `
          <div style="margin-top: 40px; padding-top: 25px; border-top: 1px solid #f3f4f6; font-family: sans-serif; text-align: center; color: #6b7280; font-size: 12px; line-height: 1.6;">
            <p style="margin: 0 0 15px 0;">This email was sent to you because you've interacted with <strong>${companyName}</strong>.</p>
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
            <p style="margin: 15px 0 0 0; color: #9ca3af; font-size: 11px;">&copy; ${year} ${companyName}. Global HQ</p>
          </div>
        `;
        const footerText = `\n\n---\nYou are receiving this because you are on our list.\nUnsubscribe: ${unsubscribeUrl}`;
        
        if (isHtml) {
          if (processed.toLowerCase().includes('</body>')) {
            processed = processed.replace(/<\/body>/i, `${footerHtml}</body>`);
          } else {
            processed += footerHtml;
          }
        } else {
          processed += footerText;
        }
      }

      return processed;
    };

    const previewContent = simulateProcessing(emailData.isHtml ? (emailData.html || emailData.text) : emailData.text, emailData.isHtml);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-gray-50/80 p-2 rounded-xl border border-gray-100">
          <div className="flex items-center gap-1">
            <Button 
              variant={previewDevice === "mobile" ? "secondary" : "ghost"} 
              size="sm" 
              onClick={() => setPreviewDevice("mobile")}
              className="h-8 w-8 p-0 rounded-lg"
            >
              <Smartphone className="w-4 h-4" />
            </Button>
            <Button 
              variant={previewDevice === "tablet" ? "secondary" : "ghost"} 
              size="sm" 
              onClick={() => setPreviewDevice("tablet")}
              className="h-8 w-8 p-0 rounded-lg"
            >
              <Tablet className="w-4 h-4" />
            </Button>
            <Button 
              variant={previewDevice === "desktop" ? "secondary" : "ghost"} 
              size="sm" 
              onClick={() => setPreviewDevice("desktop")}
              className="h-8 w-8 p-0 rounded-lg"
            >
              <Monitor className="w-4 h-4" />
            </Button>
          </div>
          <span className="text-[10px] font-bold uppercase text-gray-400 tracking-widest px-2">
            {previewDevice} View
          </span>
        </div>
        <div className="flex justify-center bg-gray-100/30 rounded-2xl p-6 border border-dashed border-gray-200 min-h-[400px] overflow-hidden">
          <motion.div 
            initial={false}
            animate={{ width: deviceWidths[previewDevice] }}
            className="bg-white shadow-2xl rounded-xl overflow-hidden border border-gray-200 h-[500px]"
          >
            {emailData.isHtml ? (
              <iframe 
                key={id || "main-preview"}
                title={`Email Preview ${id || ""}`}
                srcDoc={previewContent}
                className="w-full h-full border-none"
              />
            ) : (
              <div className="p-8 whitespace-pre-wrap font-sans text-sm text-gray-700 h-full overflow-auto">
                {previewContent}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    );
  };

  const defaultTemplates: EmailTemplate[] = [
    {
      id: "tpl-1",
      name: "Welcome Email",
      subject: "Welcome to our community!",
      content: `<html>
<body style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #f97316; padding: 30px; border-radius: 12px; text-align: center;">
    <h1 style="color: white; margin: 0;">Welcome!</h1>
  </div>
  <div style="padding: 20px;">
    <h2>We're glad you're here.</h2>
    <p>Thank you for joining our platform. We're excited to help you get started.</p>
    <a href="#" style="display: inline-block; background: #f97316; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Get Started</a>
  </div>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="font-size: 12px; color: #999; text-align: center;">© 2024 Smart Mailer. All rights reserved.</p>
</body>
</html>`
    },
    {
      id: "tpl-2",
      name: "Newsletter",
      subject: "Monthly Tech Update",
      content: `<html>
<body style="font-family: sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto;">
  <div style="padding: 20px; border-bottom: 2px solid #f97316;">
    <h1 style="margin: 0;">Tech Monthly</h1>
  </div>
  <div style="padding: 20px;">
    <h3>This Month's Highlights</h3>
    <div style="margin-bottom: 20px; padding: 15px; background: #f3f4f6; border-radius: 8px;">
      <h4 style="margin: 0 0 10px 0;">1. AI Breakthroughs</h4>
      <p style="margin: 0; font-size: 14px;">New models are changing the way we code...</p>
    </div>
    <div style="margin-bottom: 20px; padding: 15px; background: #f3f4f6; border-radius: 8px;">
      <h4 style="margin: 0 0 10px 0;">2. Web Development Trends</h4>
      <p style="margin: 0; font-size: 14px;">Vite and Tailwind are dominating the ecosystem...</p>
    </div>
  </div>
</body>
</html>`
    }
  ];

  const allTemplates = [...defaultTemplates, ...customTemplates];

  const applyTemplate = (tpl: EmailTemplate) => {
    setEmailData({
      ...emailData,
      subject: tpl.subject,
      text: tpl.content,
      isHtml: true
    });
    toast.success(`${tpl.name} applied!`);
  };

  const saveAsTemplate = () => {
    if (!emailData.subject || !emailData.text) {
      toast.error("Subject and content are required to save template");
      return;
    }
    const name = prompt("Enter template name:");
    if (!name) return;

    const newTpl: EmailTemplate = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      subject: emailData.subject,
      content: emailData.text,
      isCustom: true
    };
    setCustomTemplates([...customTemplates, newTpl]);
    toast.success("Template saved!");
  };

  const deleteTemplate = (id: string) => {
    setCustomTemplates(customTemplates.filter(t => t.id !== id));
    toast.success("Template deleted");
  };

  const handleCreateTemplateDirectly = () => {
    const name = prompt("Enter template name:");
    if (!name) return;
    const subject = prompt("Enter template subject:");
    if (!subject) return;
    const content = prompt("Enter template HTML/Text content:");
    if (!content) return;

    const newTpl: EmailTemplate = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      subject,
      content,
      isCustom: true
    };
    setCustomTemplates([...customTemplates, newTpl]);
    toast.success(`Template "${name}" created!`);
  };

  const refreshSession = () => {
    if (confirm("Are you sure you want to start a new session? This will clear current drafts and active campaign views.")) {
      setEmailData({ to: "", subject: "", text: "", isHtml: false });
      setBulkRecipients("");
      setAiPrompt("");
      setActiveCampaigns([]);
      toast.success("New session started");
    }
  };

  const campaignTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Persist history
  useEffect(() => {
    localStorage.setItem("email_history", JSON.stringify(history));
  }, [history]);

  const getApiUrl = (endpoint: string) => {
    // Robust Detection: Handles root, subfolders, and trailing slashes correctly.
    const path = window.location.pathname;
    const base = path.substring(0, path.lastIndexOf('/') + 1);
    const finalBase = base.endsWith('/') ? base : base + '/';
    return `${finalBase}api/${endpoint}`.replace(/\/+/g, '/');
  };

  const sendSingleEmail = async (to: string, data: EmailData, smtp: SMTPConfig, campaignId?: string) => {
    try {
      const response = await fetch(getApiUrl("send-email"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          smtpConfig: smtp, 
          campaignId,
          uid: user?.uid,
          emailData: {
            ...data,
            to,
            html: data.isHtml ? data.text : undefined,
            text: data.isHtml ? undefined : data.text
          } 
        }),
      });

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON response:", text);
        return { success: false, error: "Server returned HTML instead of JSON. This usually means the API route is not correctly configured or the app is in a subfolder." };
      }

      return await response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log("Fetch aborted by user or browser");
        return { success: false, error: "Request aborted" };
      }
      console.error("Fetch error:", error);
      return { success: false, error: "Network error or server unreachable" };
    }
  };

  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [smtpStatus, setSmtpStatus] = useState<"idle" | "success" | "error">("idle");

  const testSmtpConnection = async () => {
    setIsTestingSmtp(true);
    setSmtpStatus("idle");
    try {
      const response = await fetch(getApiUrl("test-smtp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smtpConfig: activeSmtp }),
      });
      
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON response:", text);
        throw new Error("Server returned HTML instead of JSON. This usually means the API route is not correctly configured or the app is in a subfolder.");
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        setSmtpStatus("success");
        toast.success("SMTP Connection Successful!");
      } else {
        setSmtpStatus("error");
        toast.error(data.error || "SMTP Connection Failed");
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return; // Ignore intentional aborts
      setSmtpStatus("error");
      console.error("SMTP Test Error:", error);
      toast.error(error.message || "Failed to connect to server");
    } finally {
      setIsTestingSmtp(false);
    }
  };

  const handleSendSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSmtp.host || !activeSmtp.user || !activeSmtp.pass) {
      toast.error("Please configure SMTP settings first");
      return;
    }
    if (!emailData.to) {
      toast.error("Please enter a recipient");
      return;
    }

    setIsSending(true);
    try {
      const result = await sendSingleEmail(emailData.to, emailData, activeSmtp);

      if (result.success) {
        toast.success("Email sent successfully!");
        const newEntry: SentEmail = {
          id: Math.random().toString(36).substr(2, 9),
          to: emailData.to,
          subject: emailData.subject,
          timestamp: Date.now(),
          status: "success"
        };
        setHistory([newEntry, ...history]);
        setEmailData({ ...emailData, to: "" });
      } else {
        throw new Error(result.error || "Failed to send email");
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsSending(false);
    }
  };

  const startCampaign = async () => {
    const recipients = extractEmails(bulkRecipients);
    if (recipients.length === 0) {
      toast.error("Please enter at least one valid recipient");
      return;
    }
    if (!activeSmtp.host || !activeSmtp.user || !activeSmtp.pass) {
      toast.error("Please configure SMTP settings first");
      return;
    }

    const campaignId = `camp_${Math.random().toString(36).substr(2, 9)}`;
    const campaignName = `Campaign ${new Date().toLocaleString()} (${activeSmtp.name})`;
    
    // Initialize campaign in Firestore
    try {
      await setDoc(doc(db, "campaigns", campaignId), {
        id: campaignId,
        name: campaignName,
        subject: emailData.subject,
        createdAt: serverTimestamp(),
        totalSent: recipients.length,
        smtpUser: activeSmtp.user,
        uid: user?.uid,
        status: "running",
        currentIndex: 0
      });

      // Call Backend to start background processing
      await fetch(getApiUrl("start-campaign"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpConfig: activeSmtp,
          emailData,
          recipients,
          campaignId,
          delay: campaignDelay,
          uid: user?.uid
        })
      });

      toast.success(`Campaign started in background! You can close the browser.`);
    } catch (err) {
      console.error("Failed to start campaign:", err);
      toast.error("Failed to start campaign");
    }
  };

  const deleteCampaign = async (id: string) => {
    try {
      await fetch(getApiUrl("delete-campaign"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: id, uid: user?.uid })
      });
      toast.success("Campaign deleted");
    } catch (err) {
      toast.error("Failed to delete campaign");
    }
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      await fetch(getApiUrl("delete-history"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId: id, uid: user?.uid })
      });
    } catch (err) {
      toast.error("Failed to delete item");
    }
  };

  const clearHistory = async () => {
    if (!confirm("Are you sure you want to clear all history?")) return;
    try {
      await fetch(getApiUrl("clear-history"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: user?.uid })
      });
      toast.success("History cleared");
    } catch (err) {
      toast.error("Failed to clear history");
    }
  };

  const generateWithAI = async () => {
    if (!aiPrompt) {
      toast.error("Please enter a prompt for the AI");
      return;
    }

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [{
          role: "user",
          parts: [{ text: `Draft a professional email based on this prompt: "${aiPrompt}". 
            If the user wants HTML, provide a modern HTML template with inline CSS.
            Return the result in JSON format with "subject" and "body" fields.` }]
        }],
        config: {
          responseMimeType: "application/json"
        }
      });

      const content = JSON.parse(response.text || "{}");
      setEmailData({
        ...emailData,
        subject: content.subject || emailData.subject,
        text: content.body || content.text || emailData.text
      });
      toast.success("AI draft generated!");
      setAiPrompt("");
    } catch (error: any) {
      console.error("AI Error:", error);
      toast.error("Failed to generate AI draft");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-[#1a1a1a] font-sans selection:bg-orange-100 selection:text-orange-900 relative overflow-x-hidden tech-grid">
      {/* Background Pattern */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-200/30 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-100/30 rounded-full blur-[120px]" />
      </div>

      <Toaster position="top-center" richColors />
      
      {unsubscribeContext ? (
        <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center p-6 font-serif">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md w-full bg-white rounded-[32px] p-12 shadow-2xl shadow-stone-200 text-center space-y-8"
          >
            <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto text-stone-400">
              <Mail className="w-10 h-10" />
            </div>
            
            <div className="space-y-4">
              <h1 className="text-3xl font-bold text-stone-900 tracking-tight">Email Preferences</h1>
              <p className="text-stone-500 text-lg leading-relaxed">
                We are sorry to see you go. Would you like to stop receiving emails at:
              </p>
              <div className="py-3 px-4 bg-stone-50 rounded-2xl font-mono text-sm font-bold text-stone-800 break-all">
                {unsubscribeContext.email}
              </div>
            </div>

            {!isUnsubscribedDone ? (
              <div className="space-y-4 pt-4">
                <Button 
                  onClick={handleDirectUnsubscribe}
                  disabled={isUnsubscribingProcess}
                  className="w-full h-14 bg-stone-900 hover:bg-black text-white rounded-2xl text-lg font-bold shadow-xl shadow-stone-200 transition-all active:scale-95"
                >
                  {isUnsubscribingProcess ? <Loader2 className="w-6 h-6 animate-spin" /> : "Confirm Unsubscribe"}
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => window.location.href = '/'}
                  className="text-stone-400 hover:text-stone-600 text-sm font-medium"
                >
                  Actually, keep me on the list
                </Button>
              </div>
            ) : (
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="space-y-6 pt-4"
              >
                <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <p className="text-stone-900 font-bold text-xl">Successfully Unsubscribed</p>
                <p className="text-stone-500 text-sm">You won't receive any more marketing emails to this address. You can close this window now.</p>
                <Button 
                  variant="outline" 
                  onClick={() => window.location.href = '/'}
                  className="w-full h-12 border-stone-200 rounded-xl text-stone-600 font-bold"
                >
                  Return Home
                </Button>
              </motion.div>
            )}

            <div className="pt-8 border-t border-stone-100">
              <p className="text-[10px] text-stone-400 uppercase tracking-widest font-bold">
                Secure Opt-out System &bull; GDPR Protected
              </p>
            </div>
          </motion.div>
        </div>
      ) : isAuthLoading ? (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full mb-4"
          />
          <p className="text-gray-500 font-medium animate-pulse">Securing your session...</p>
        </div>
      ) : !user ? (
        <div className="fixed inset-0 z-[100] bg-white/80 backdrop-blur-xl flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md w-full"
          >
            <Card className="border-none shadow-2xl shadow-orange-200/50 rounded-3xl overflow-hidden">
              <CardHeader className="text-center pb-2">
                <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200 mx-auto mb-4">
                  <Mail className="text-white w-8 h-8" />
                </div>
                <CardTitle className="text-2xl font-bold">Smart SMTP Mailer</CardTitle>
                <CardDescription>Professional Email Marketing System</CardDescription>
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                <form onSubmit={handleEmailAuth} className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">Email Address</Label>
                    <Input 
                      type="email" 
                      value={loginEmail} 
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="rounded-xl border-gray-200 h-12"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">Password</Label>
                      {!isSigningUp && (
                        <button 
                          type="button"
                          onClick={handlePasswordReset}
                          disabled={isResetting}
                          className="text-[10px] font-bold text-orange-600 hover:underline uppercase tracking-wider"
                        >
                          {isResetting ? "Sending..." : "Forgot Password?"}
                        </button>
                      )}
                    </div>
                    <Input 
                      type="password" 
                      value={loginPassword} 
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className="rounded-xl border-gray-200 h-12"
                    />
                  </div>
                  <Button 
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-2xl h-12 font-bold shadow-lg shadow-orange-200 transition-all active:scale-[0.98]"
                  >
                    {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : (isSigningUp ? "Create Account" : "Sign In")}
                  </Button>
                </form>

                <div className="text-center">
                  <button 
                    onClick={() => setIsSigningUp(!isSigningUp)}
                    className="text-xs font-bold text-gray-500 hover:text-orange-600 transition-colors"
                  >
                    {isSigningUp ? "Already have an account? Sign In" : "Don't have an account? Create one"}
                  </button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-gray-100" />
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase font-bold text-gray-400">
                    <span className="bg-white px-4">Or continue with</span>
                  </div>
                </div>

                <Button 
                  onClick={handleLogin} 
                  disabled={isLoggingIn}
                  variant="outline"
                  className="w-full border-gray-200 hover:bg-gray-50 rounded-2xl h-12 font-bold transition-all active:scale-[0.98]"
                >
                  {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5 mr-3" />}
                  Google Account
                </Button>
                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold text-center">Secure Enterprise Access v2.2.0</p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      ) : null}

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-md w-full"
            >
              <Card className="border-none shadow-2xl rounded-3xl overflow-hidden">
                <CardHeader className="border-b border-gray-50">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Account Settings</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setShowProfileModal(false)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">Change Password</Label>
                    <Input 
                      type="password" 
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="rounded-xl border-gray-200 h-11"
                    />
                    <p className="text-[10px] text-gray-400">Minimum 6 characters required.</p>
                  </div>
                  <Button 
                    onClick={handleChangePassword}
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-xl h-11 font-bold"
                  >
                    Update Password
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-gray-200 bg-white/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-200"
            >
              <Mail className="text-white w-6 h-6" />
            </motion.div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600">Smart Mailer</h1>
          </div>
          <div className="flex items-center gap-4">
            {activeCampaigns.some(c => c.isActive) && (
              <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200 animate-pulse px-3 py-1 rounded-full">
                {activeCampaigns.filter(c => c.isActive).length} Campaigns Running
              </Badge>
            )}
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={refreshSession}
              className="text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="hidden sm:inline">New Session</span>
            </Button>
            
            <div className="h-8 w-[1px] bg-gray-200 mx-2" />
            
            {user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-xs font-bold text-gray-900 leading-none">{user.displayName || user.email?.split('@')[0]}</span>
                  <span className="text-[10px] text-gray-500">{user.email}</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowProfileModal(true)}
                  className="text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg p-2"
                >
                  <Settings className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleLogout}
                  className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-2"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg gap-2"
              >
                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                <span className="hidden sm:inline">{isLoggingIn ? "Logging in..." : "Login"}</span>
              </Button>
            )}
            
            <div className="h-8 w-[1px] bg-gray-200 mx-2 hidden sm:block" />
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] hidden sm:block">v2.1.0</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Composer & Campaigns */}
          <div className="lg:col-span-8 space-y-8">
            <Tabs defaultValue="compose" className="w-full">
              <TabsList className="grid w-full grid-cols-4 md:grid-cols-8 h-auto mb-6 bg-gray-100/50 p-1 rounded-xl">
                <TabsTrigger value="compose" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Mail className="w-4 h-4 mr-2" /> Single
                </TabsTrigger>
                <TabsTrigger value="bulk" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Users className="w-4 h-4 mr-2" /> Bulk
                </TabsTrigger>
                <TabsTrigger value="groups" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Layers className="w-4 h-4 mr-2" /> Groups
                </TabsTrigger>
                <TabsTrigger value="templates" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <FileText className="w-4 h-4 mr-2" /> Templates
                </TabsTrigger>
                <TabsTrigger value="ai" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Sparkles className="w-4 h-4 mr-2 text-orange-500" /> AI
                </TabsTrigger>
                <TabsTrigger value="spam" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Ban className="w-4 h-4 mr-2 text-red-500" /> Anti-Spam
                </TabsTrigger>
                <TabsTrigger value="optouts" className="relative rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <UserX className="w-4 h-4 mr-2 text-red-600" /> Opt-outs
                  {unsubscribes.length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white animate-pulse">
                      {unsubscribes.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="stats" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <BarChart3 className="w-4 h-4 mr-2 text-blue-500" /> Stats
                </TabsTrigger>
              </TabsList>

              <TabsContent value="compose">
                <Card className="border-none shadow-xl shadow-gray-200/50 rounded-2xl overflow-hidden bg-white/70 backdrop-blur-xl">
                  <CardHeader className="border-b border-gray-50 pb-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">New Message</CardTitle>
                        <CardDescription>Send a single email instantly</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="html-mode" className="text-xs font-medium text-gray-500">HTML Mode</Label>
                        <Switch 
                          id="html-mode" 
                          checked={emailData.isHtml} 
                          onCheckedChange={(val) => setEmailData({...emailData, isHtml: val})} 
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-8 space-y-6">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Recipient</Label>
                      <Input 
                        placeholder="recipient@example.com" 
                        value={emailData.to}
                        onChange={(e) => setEmailData({...emailData, to: e.target.value})}
                        onBlur={() => {
                          const cleaned = extractEmails(emailData.to);
                          if (cleaned.length > 0) {
                            setEmailData({...emailData, to: cleaned[0]});
                          }
                        }}
                        className="border-gray-200 rounded-lg h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Subject</Label>
                      <Input 
                        placeholder="Enter subject line" 
                        value={emailData.subject}
                        onChange={(e) => setEmailData({...emailData, subject: e.target.value})}
                        className="border-gray-200 rounded-lg h-11"
                      />
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                          {emailData.isHtml ? "HTML Content" : "Text Content"}
                        </Label>
                        <div className="flex gap-1">
                          {[
                            { label: "Unsubscribe", value: "{{unsubscribe}}", icon: UserX },
                            { label: "Company", value: "{{company}}", icon: Users },
                            { label: "Year", value: "{{year}}", icon: Clock },
                            { label: "SpinTax", value: "{Hello|Hi|Greetings}", icon: RotateCcw },
                          ].map((tag) => (
                            <Button
                              key={tag.label}
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] px-2 rounded-md border-gray-100 bg-gray-50/50 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all font-medium"
                              onClick={() => {
                                setEmailData({ ...emailData, text: emailData.text + " " + tag.value });
                                toast.success(`Added ${tag.label} placeholder`);
                              }}
                            >
                              <tag.icon className="w-3 h-3 mr-1" />
                              {tag.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <Textarea 
                        placeholder={emailData.isHtml ? "<html><body><h1>{Hello|Hi|Greetings}</h1></body></html>" : "Write your message here... Use {Hi|Hello} for variety."} 
                        className="min-h-[250px] border-gray-200 rounded-lg font-mono text-sm focus-visible:ring-orange-500/20 focus-visible:border-orange-500 transition-all shadow-inner bg-gray-50/30"
                        value={emailData.text}
                        onChange={(e) => setEmailData({...emailData, text: e.target.value})}
                      />
                      <p className="text-[10px] text-gray-400 italic">
                        Tip: Use <b>{"{Option 1|Option 2}"}</b> to rotate text and avoid spam filters.
                      </p>
                    </div>
                    
                    {/* Preview Section */}
                    {emailData.text && (
                      <div className="pt-4 border-t border-gray-50">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4 block">Live Preview</Label>
                        {renderPreview()}
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="bg-gray-50/50 border-t border-gray-100 p-6 flex justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline"
                        onClick={saveAsTemplate}
                        className="border-gray-200 hover:border-orange-200 hover:bg-orange-50/50 rounded-xl h-11"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save as Template
                      </Button>
                      <Button 
                        variant="ghost"
                        onClick={() => setEmailData({ ...emailData, to: "", subject: "", text: "" })}
                        className="text-gray-400 hover:text-red-500 rounded-xl h-11"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <Button 
                      onClick={handleSendSingle} 
                      disabled={isSending}
                      className="bg-orange-500 hover:bg-orange-600 text-white px-8 rounded-xl h-11 shadow-lg shadow-orange-200"
                    >
                      {isSending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                      Send Now
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              <TabsContent value="bulk">
                <div className="space-y-6">
                  {activeCampaigns.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between px-2">
                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Active Campaigns ({activeCampaigns.length})</h3>
                        <div className="flex gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setActiveCampaigns(prev => prev.map(c => ({...c, isPaused: true})))}
                            className="text-[10px] font-bold text-orange-600 hover:bg-orange-50 h-7"
                          >
                            <Pause className="w-3 h-3 mr-1" /> Pause All
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setActiveCampaigns(prev => prev.map(c => ({...c, isPaused: false})))}
                            className="text-[10px] font-bold text-green-600 hover:bg-green-50 h-7"
                          >
                            <Play className="w-3 h-3 mr-1" /> Resume All
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setActiveCampaigns(prev => prev.filter(c => c.isActive))}
                            className="text-[10px] font-bold text-gray-400 hover:bg-gray-50 h-7"
                          >
                            <Trash2 className="w-3 h-3 mr-1" /> Clear Completed
                          </Button>
                        </div>
                      </div>
                      {activeCampaigns.map((camp) => (
                        <Card key={camp.id} className="tech-card border-none overflow-hidden">
                          <CardHeader className="pb-2 border-b border-border/50">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                <Clock className="w-4 h-4 text-orange-500" />
                                <span className="tech-mono uppercase opacity-70">{camp.name}</span>
                              </CardTitle>
                              <div className="flex items-center gap-2">
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={() => setActiveCampaigns(prev => prev.map(c => c.id === camp.id ? {...c, isPaused: !c.isPaused} : c))}
                                  className="h-8 w-8 p-0"
                                >
                                  {camp.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-8 w-8 p-0 text-red-400 hover:text-red-600"
                                  title="Unsubscribe/Block current recipient"
                                  onClick={() => {
                                    const currentEmail = camp.recipients[camp.currentIndex];
                                    if (currentEmail) {
                                      setManualUnsubscribeEmail(currentEmail);
                                      toast.info(`Email ${currentEmail} loaded to block form. Go to Anti-Spam tab.`);
                                    } else {
                                      toast.error("No active recipient");
                                    }
                                  }}
                                >
                                  <UserX className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={() => setActiveCampaigns(prev => prev.map(c => c.id === camp.id ? {...c, isActive: false} : c))}
                                  className="h-8 w-8 p-0 text-red-500"
                                >
                                  <StopCircle className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={() => {
                                    navigator.clipboard.writeText(camp.logs.join("\n"));
                                    toast.success("Logs copied to clipboard");
                                  }}
                                  className="h-8 w-8 p-0 text-gray-400 hover:text-orange-500"
                                  title="Copy Logs"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={() => setActiveCampaigns(prev => prev.map(c => c.id === camp.id ? {...c, logs: []} : c))}
                                  className="h-8 w-8 p-0 text-gray-400 hover:text-orange-500"
                                  title="Clear Logs"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="flex justify-between text-xs font-medium text-gray-500 mb-1">
                              <span>{camp.currentIndex} of {camp.total} sent</span>
                              <span>{Math.round((camp.currentIndex / camp.total) * 100)}%</span>
                            </div>
                            <Progress value={(camp.currentIndex / camp.total) * 100} className="h-2 bg-orange-100" />
                            <ScrollArea className="h-24 bg-black/5 rounded-lg border border-border/50 p-2">
                              <div className="space-y-1">
                                {camp.logs.map((log, i) => (
                                  <p key={i} className="tech-mono opacity-80">{log}</p>
                                ))}
                              </div>
                            </ScrollArea>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  <Card className="border-none shadow-xl shadow-gray-200/50 rounded-2xl overflow-hidden bg-white/70 backdrop-blur-xl">
                    <CardHeader className="border-b border-gray-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-lg">Bulk Campaign</CardTitle>
                          <CardDescription>Send to multiple recipients with custom delays</CardDescription>
                        </div>
                        <div className="flex items-center gap-3">
                          <input 
                            type="file" 
                            ref={fileInputRef} 
                            onChange={handleFileUpload} 
                            className="hidden" 
                            accept=".txt,.csv"
                          />
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => fileInputRef.current?.click()}
                            className="rounded-lg border-gray-200 hover:bg-gray-50 h-9"
                          >
                            <Plus className="w-4 h-4 mr-2" /> Import List
                          </Button>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs font-medium text-gray-500">HTML</Label>
                            <Switch 
                              checked={emailData.isHtml} 
                              onCheckedChange={(val) => setEmailData({...emailData, isHtml: val})} 
                            />
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-8 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Recipient List</Label>
                              <div className="flex items-center gap-2">
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={() => {
                                    const cleaned = extractEmails(bulkRecipients);
                                    setBulkRecipients(formatEmailsForDisplay(cleaned));
                                    toast.success("List formatted and cleaned!");
                                  }}
                                  className="h-6 text-[10px] text-orange-600 hover:bg-orange-50 px-2 rounded"
                                >
                                  Smart Format
                                </Button>
                                {groups.length > 0 && (
                                  <select 
                                    className="text-[10px] border-gray-200 rounded p-1 bg-white"
                                    onChange={(e) => loadGroup(e.target.value)}
                                    defaultValue=""
                                  >
                                    <option value="" disabled>Load Group</option>
                                    {groups.map(g => (
                                      <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </div>
                            <Textarea 
                              placeholder="Enter emails separated by comma or new line..." 
                              className="min-h-[150px] border-gray-200 rounded-lg text-sm"
                              value={bulkRecipients}
                              onChange={(e) => setBulkRecipients(e.target.value)}
                              onBlur={() => {
                                const cleaned = extractEmails(bulkRecipients);
                                if (cleaned.length > 0) {
                                  setBulkRecipients(formatEmailsForDisplay(cleaned));
                                }
                              }}
                            />
                            <p className="text-[10px] text-gray-400">Example: user1@mail.com, user2@mail.com</p>
                          </div>
                        </div>
                        <div className="space-y-6">
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Campaign Delay (Seconds)</Label>
                            <div className="flex items-center gap-4">
                              <Input 
                                type="number" 
                                value={campaignDelay}
                                onChange={(e) => setCampaignDelay(parseInt(e.target.value) || 1)}
                                className="border-gray-200 rounded-lg h-11"
                              />
                              <Badge variant="secondary" className="h-11 px-4 rounded-lg">
                                {campaignDelay}s wait
                              </Badge>
                            </div>
                            <p className="text-[10px] text-gray-400">Wait time between each email to avoid spam filters.</p>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Subject</Label>
                            <Input 
                              placeholder="Campaign Subject" 
                              value={emailData.subject}
                              onChange={(e) => setEmailData({...emailData, subject: e.target.value})}
                              className="border-gray-200 rounded-lg h-11"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                            {emailData.isHtml ? "HTML Template" : "Text Template"}
                          </Label>
                          <div className="flex gap-1">
                            {[
                              { label: "Unsubscribe", value: "{{unsubscribe}}", icon: UserX },
                              { label: "Company", value: "{{company}}", icon: Users },
                              { label: "Year", value: "{{year}}", icon: Clock },
                              { label: "SpinTax", value: "{Hello|Hi|Greetings}", icon: RotateCcw },
                            ].map((tag) => (
                              <Button
                                key={tag.label}
                                variant="outline"
                                size="sm"
                                className="h-7 text-[10px] px-2 rounded-md border-gray-100 bg-gray-50/50 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all font-medium"
                                onClick={() => {
                                  setEmailData({ ...emailData, text: emailData.text + " " + tag.value });
                                  toast.success(`Added ${tag.label} placeholder`);
                                }}
                              >
                                <tag.icon className="w-3 h-3 mr-1" />
                                {tag.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <Textarea 
                          placeholder="Email content..." 
                          className="min-h-[220px] border-gray-200 rounded-lg font-mono text-sm focus-visible:ring-orange-500/20 focus-visible:border-orange-500 transition-all shadow-inner bg-gray-50/30"
                          value={emailData.text}
                          onChange={(e) => setEmailData({...emailData, text: e.target.value})}
                        />
                      </div>

                      {/* Preview Section */}
                      {emailData.text && (
                        <div className="pt-4 border-t border-gray-50">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4 block">Campaign Preview</Label>
                          {renderPreview("bulk-preview")}
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="bg-gray-50/50 border-t border-gray-100 p-6 flex justify-between gap-4">
                      <Button 
                        variant="outline"
                        onClick={saveAsTemplate}
                        className="border-gray-200 hover:border-orange-200 hover:bg-orange-50/50 rounded-xl h-11"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save as Template
                      </Button>
                      <Button 
                        onClick={startCampaign} 
                        disabled={activeCampaigns.some(c => c.isActive && c.smtpConfig.id === activeSmtp.id)}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-8 rounded-xl h-11 shadow-lg shadow-orange-200"
                      >
                        <Play className="w-4 h-4 mr-2" />
                        Start Campaign
                      </Button>
                    </CardFooter>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="groups">
                <div className="space-y-6">
                  <Card className="border-none shadow-xl shadow-gray-200/50 rounded-2xl overflow-hidden bg-white/70 backdrop-blur-xl">
                    <CardHeader className="border-b border-gray-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-lg">Email Groups & Categories</CardTitle>
                          <CardDescription>Organize your contacts into separate groups.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input 
                            placeholder="Group Name" 
                            className="h-9 w-40 border-gray-200 rounded-lg"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                          />
                          <Button 
                            size="sm" 
                            onClick={handleAddGroup}
                            className="bg-orange-500 hover:bg-orange-600 text-white rounded-lg h-9"
                          >
                            <Plus className="w-4 h-4 mr-2" /> Create
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-8">
                      {groups.length === 0 ? (
                        <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-2xl">
                          <Layers className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                          <p className="text-gray-400 text-sm">No groups created yet. Create one to start organizing.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {groups.map((group) => (
                            <div 
                              key={group.id} 
                              className="group border border-gray-100 rounded-2xl p-4 hover:border-orange-200 hover:bg-orange-50/30 transition-all"
                            >
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-50">
                                    <Users className="w-5 h-5 text-orange-500" />
                                  </div>
                                  <div>
                                    <h3 className="font-bold text-sm text-gray-900">{group.name}</h3>
                                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{group.emails.length} Recipients</p>
                                  </div>
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={() => handleDeleteGroup(group.id)}
                                  className="h-8 w-8 p-0 text-gray-300 hover:text-red-500 rounded-lg"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => loadGroup(group.id)}
                                  className="flex-1 min-w-[100px] h-8 text-[10px] font-bold uppercase tracking-wider rounded-lg border-gray-200"
                                >
                                  Load to Bulk
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => handleAddEmailsToGroup(group.id)}
                                  className="flex-1 min-w-[100px] h-8 text-[10px] font-bold uppercase tracking-wider rounded-lg border-gray-200"
                                >
                                  Add Current
                                </Button>
                                <div className="relative flex-1 min-w-[100px]">
                                  <input 
                                    type="file" 
                                    className="hidden" 
                                    id={`upload-${group.id}`}
                                    onChange={(e) => handleGroupFileUpload(group.id, e)}
                                  />
                                  <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={() => document.getElementById(`upload-${group.id}`)?.click()}
                                    className="w-full h-8 text-[10px] font-bold uppercase tracking-wider rounded-lg border-orange-100 text-orange-600 hover:bg-orange-50"
                                  >
                                    <Upload className="w-3.5 h-3.5 mr-2" />
                                    Import
                                  </Button>
                                </div>
                                <div className="divide-y divide-gray-50 bg-black/5 rounded-xl border border-border/50 max-h-48 overflow-y-auto mt-4">
                                  {group.emails.length === 0 ? (
                                    <p className="p-3 text-center text-xs text-gray-400 italic">No emails in this group yet.</p>
                                  ) : (
                                    group.emails.map((email, emailIdx) => (
                                      <div key={emailIdx} className="p-2 flex items-center justify-between group/item">
                                        <span className="text-[11px] font-mono text-gray-600 truncate mr-2">{email}</span>
                                        <Button 
                                          variant="ghost" 
                                          size="sm" 
                                          onClick={() => handleDeleteEmailFromGroup(group.id, email)}
                                          className="h-6 w-6 p-0 text-gray-300 hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-opacity"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="templates">
                <Card className="border-none shadow-xl shadow-gray-200/50 rounded-2xl overflow-hidden bg-white/70 backdrop-blur-xl">
                  <CardHeader className="border-b border-gray-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">Template Library</CardTitle>
                        <CardDescription>Quickly start with a pre-designed HTML template.</CardDescription>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={handleCreateTemplateDirectly}
                        className="border-orange-200 text-orange-600 hover:bg-orange-50 rounded-lg h-9"
                      >
                        <Plus className="w-4 h-4 mr-2" /> Create New
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {allTemplates.map((tpl) => (
                      <div 
                        key={tpl.id} 
                        className="group relative border border-gray-100 rounded-xl p-4 hover:border-orange-200 hover:bg-orange-50/30 transition-all cursor-pointer"
                        onClick={() => applyTemplate(tpl)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-semibold text-sm">{tpl.name}</h3>
                          <div className="flex items-center gap-2">
                            {tpl.isCustom && (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteTemplate(tpl.id);
                                }}
                                className="h-6 w-6 p-0 text-gray-300 hover:text-red-500 rounded-lg"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            )}
                            <Plus className="w-4 h-4 text-gray-300 group-hover:text-orange-500" />
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400 line-clamp-2">{tpl.subject}</p>
                        <div className="mt-4 h-24 bg-gray-50 rounded border border-gray-100 overflow-hidden opacity-50 group-hover:opacity-100 transition-opacity">
                           <div className="scale-[0.2] origin-top-left p-4 w-[500%]">
                             <div dangerouslySetInnerHTML={{ __html: tpl.content }} />
                           </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                  {emailData.text && (
                    <CardFooter className="border-t border-gray-50 pt-6 block">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4 block">Template Preview</Label>
                      {renderPreview("template-preview")}
                    </CardFooter>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="ai">
                <Card className="border-none shadow-xl shadow-gray-200/50 rounded-2xl overflow-hidden bg-white/70 backdrop-blur-xl">
                  <CardHeader className="border-b border-gray-50">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-orange-500" />
                      <CardTitle className="text-lg">AI Smart Drafter</CardTitle>
                    </div>
                    <CardDescription>Generate professional text or HTML templates with AI.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-8 space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Describe your email</Label>
                      <Textarea 
                        placeholder="e.g., A newsletter for a tech blog, include a modern HTML layout with sections for 3 articles." 
                        className="min-h-[150px] border-gray-200 rounded-lg"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                      />
                    </div>
                    <Button 
                      onClick={generateWithAI} 
                      disabled={isGenerating}
                      variant="outline"
                      className="w-full border-orange-200 text-orange-600 hover:bg-orange-50 rounded-xl h-11"
                    >
                      {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                      Generate Smart Draft
                    </Button>
                    {emailData.text && (
                      <div className="pt-4 flex justify-end">
                        <Button 
                          variant="outline"
                          size="sm"
                          onClick={saveAsTemplate}
                          className="border-gray-200 hover:border-orange-200 hover:bg-orange-50/50 rounded-lg h-9"
                        >
                          <Save className="w-3.5 h-3.5 mr-2" />
                          Save as Template
                        </Button>
                      </div>
                    )}
                    {emailData.text && (
                      <div className="pt-6 border-t border-gray-50">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4 block">AI Draft Preview</Label>
                        {renderPreview("ai-preview")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="spam">
                <Card className="border-none shadow-xl rounded-2xl overflow-hidden bg-white/70 backdrop-blur-xl">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Ban className="w-5 h-5 text-red-500" />
                      Spam Prevention Guide
                    </CardTitle>
                    <CardDescription>Follow these steps to ensure your emails land in the Inbox</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-xl bg-green-50 border border-green-100 space-y-2">
                        <h4 className="text-sm font-bold text-green-800 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" /> Technical Setup
                        </h4>
                        <ul className="text-xs text-green-700 space-y-1 list-disc pl-4">
                          <li>Configure <b>SPF</b> records on your domain</li>
                          <li>Enable <b>DKIM</b> signing in your SMTP</li>
                          <li>Set up <b>DMARC</b> policy (p=none or p=quarantine)</li>
                          <li>Ensure your domain is at least 30 days old</li>
                        </ul>
                      </div>
                      <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 space-y-2">
                        <h4 className="text-sm font-bold text-blue-800 flex items-center gap-2">
                          <Sparkles className="w-4 h-4" /> Content Strategy
                        </h4>
                        <ul className="text-xs text-blue-700 space-y-1 list-disc pl-4">
                          <li>Use <b>SpinTax</b> {"{Hi|Hello}"} to vary content</li>
                          <li>Avoid "spammy" words (Free, Cash, Winner, !!!)</li>
                          <li>Keep image-to-text ratio low (more text)</li>
                          <li><b>Mandatory:</b> Unsubscribe link (Automatically added)</li>
                        </ul>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-orange-50 border border-orange-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-orange-800 flex items-center gap-2">
                          <Clock className="w-4 h-4" /> Smart Warm-up Mode
                        </h4>
                        <Switch id="warmup" />
                      </div>
                      <p className="text-xs text-orange-700">
                        Warm-up mode automatically adds random delays (5-15s) and limits initial volume to build sender reputation.
                      </p>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-gray-100">
                      <Label className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                        <Code className="w-4 h-4 text-blue-500" /> Smart Unsubscribe Link Tool
                      </Label>
                      <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-100 space-y-3">
                        <Input 
                          placeholder="Test Email Address..." 
                          className="bg-white rounded-lg h-10"
                          value={testUnsubEmail}
                          onChange={(e) => setTestUnsubEmail(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            className="flex-1 bg-white hover:bg-blue-50 text-blue-600 border-blue-200 rounded-xl"
                            onClick={handleCopyTestUnsubLink}
                            disabled={!testUnsubEmail || !user}
                          >
                            <Copy className="w-4 h-4 mr-2" /> Copy Link
                          </Button>
                          <Button 
                            variant="outline" 
                            className="flex-1 bg-white hover:bg-orange-50 text-orange-600 border-orange-200 rounded-xl"
                            onClick={() => {
                              if (!testUnsubEmail) return;
                              const encoded = btoa(testUnsubEmail.toLowerCase());
                              window.open(`/?page=unsubscribe&e=${encodeURIComponent(encoded)}&u=${user?.uid}`, '_blank');
                            }}
                            disabled={!testUnsubEmail || !user}
                          >
                            <Eye className="w-4 h-4 mr-2" /> Preview Page
                          </Button>
                        </div>
                        <p className="text-[10px] text-blue-400">
                          Use these tools to test your unsubscribe page live. It works directly inside this app!
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-gray-100">
                      <Label className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                        <UserX className="w-4 h-4 text-red-500" /> Manual Opt-out / Blacklist
                      </Label>
                      <form onSubmit={handleAddManualUnsubscribe} className="flex gap-2">
                        <Input 
                          placeholder="Enter email to block permanently..." 
                          className="rounded-lg h-11"
                          type="email"
                          value={manualUnsubscribeEmail}
                          onChange={(e) => setManualUnsubscribeEmail(e.target.value)}
                        />
                        <Button 
                          type="submit" 
                          disabled={isAddingUnsubscribe || !manualUnsubscribeEmail}
                          className="bg-red-500 hover:bg-red-600 text-white rounded-xl h-11 px-6 shadow-lg shadow-red-100"
                        >
                          {isAddingUnsubscribe ? <Loader2 className="w-4 h-4 animate-spin" /> : "Block Email"}
                        </Button>
                      </form>
                      <p className="text-[10px] text-gray-400 italic">
                        Emails added here will be automatically skipped in all future campaigns.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">Spam Score Checker</Label>
                      <div className="flex gap-2">
                        <Input placeholder="Paste your subject line to check..." className="rounded-lg h-10" />
                        <Button variant="outline" className="rounded-lg h-10">Analyze</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="optouts">
                <div className="space-y-6">
                  <Card className="border-none shadow-xl shadow-gray-200/50 rounded-2xl overflow-hidden bg-white/70 backdrop-blur-xl">
                    <CardHeader className="border-b border-gray-50 flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <UserX className="w-5 h-5 text-red-500" />
                          Unsubscribe Management (Live)
                        </CardTitle>
                        <CardDescription>Real-time list of recipients who have opted out.</CardDescription>
                      </div>
                      <Badge variant="outline" className="bg-red-50 text-red-600 border-red-100 px-3 py-1">
                        Total: {unsubscribes.length} Records
                      </Badge>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="h-[550px]">
                        <div className="divide-y divide-gray-50">
                          {unsubscribes.length === 0 ? (
                            <div className="p-20 text-center space-y-4">
                              <div className="w-16 h-16 bg-gray-50 text-gray-300 rounded-full flex items-center justify-center mx-auto mb-4">
                                <UserX className="w-8 h-8" />
                              </div>
                              <p className="text-gray-400 font-medium">No one has unsubscribed yet.</p>
                              <p className="text-[11px] text-gray-400 max-w-sm mx-auto">
                                When a recipient clicks the unsubscribe link in your smart email footer, 
                                their email will automatically appear here and be blocked from future sends.
                              </p>
                            </div>
                          ) : (
                            unsubscribes.map((sub) => (
                              <motion.div 
                                key={sub.id} 
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="p-6 hover:bg-gray-50/80 transition-all flex items-center justify-between group"
                              >
                                <div className="flex items-center gap-4">
                                  <div className="w-11 h-11 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
                                    <UserX className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <h4 className="font-mono text-sm font-bold text-gray-900">{sub.email}</h4>
                                    <div className="flex items-center gap-3 mt-1">
                                      <span className="flex items-center text-[10px] text-gray-400">
                                        <Clock className="w-3 h-3 mr-1" />
                                        {sub.unsubscribedAt?.seconds ? new Date(sub.unsubscribedAt.seconds * 1000).toLocaleString() : "Just now"}
                                      </span>
                                      <span className="flex items-center text-[10px] text-gray-500 font-medium bg-gray-100 px-2 py-0.5 rounded-full">
                                        Source: {sub.source === 'link' ? 'Email Link' : 'Manual Block'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="h-9 px-3 text-[11px] font-bold text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl"
                                    onClick={() => handleRemoveUnsubscribe(sub.id)}
                                  >
                                    <RotateCcw className="w-3.5 h-3.5 mr-2" />
                                    Resubscribe
                                  </Button>
                                </div>
                              </motion.div>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </CardContent>
                    <CardFooter className="bg-gray-50/50 p-4 border-t border-gray-100">
                      <p className="text-[10px] text-center w-full text-gray-400">
                        <b>Compliance Notice:</b> Removing someone from this list without their permission may violate anti-spam laws.
                      </p>
                    </CardFooter>
                  </Card>
                </div>
              </TabsContent>
              
              <TabsContent value="stats">
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[
                      { label: "Total Sent", value: history.length, icon: Send, color: "text-blue-500", bg: "bg-blue-50" },
                      { label: "Success Rate", value: history.length > 0 ? Math.round((history.filter(h => h.status === "success").length / history.length) * 100) + "%" : "0%", icon: CheckCircle2, color: "text-green-500", bg: "bg-green-50" },
                      { label: "Active Campaigns", value: activeCampaigns.filter(c => c.isActive).length, icon: Clock, color: "text-orange-500", bg: "bg-orange-50" },
                    ].map((stat, i) => (
                      <Card key={i} className="tech-card border-none">
                        <CardContent className="p-6">
                          <p className="tech-header mb-1">{stat.label}</p>
                          <p className={`tech-stat-value ${stat.color}`}>{stat.value}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <Card className="border-none shadow-xl shadow-gray-200/50 rounded-2xl overflow-hidden bg-white/70 backdrop-blur-xl">
                    <CardHeader className="border-b border-gray-50 flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">Campaign Analytics</CardTitle>
                        <CardDescription>Detailed performance metrics for your campaigns.</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="h-[500px]">
                        {campaigns.length === 0 ? (
                          <div className="p-12 text-center text-gray-400 text-sm">No campaigns found</div>
                        ) : (
                          <div className="divide-y divide-gray-50">
                            {campaigns.map((camp) => (
                              <div key={camp.id} className="p-6 hover:bg-gray-50 transition-colors">
                                <div className="flex items-center justify-between mb-4">
                                  <div>
                                    <h4 className="font-bold text-gray-900">{camp.name}</h4>
                                    <p className="text-xs text-gray-500">{camp.subject}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      className="h-8 text-[10px] font-bold border-red-100 text-red-600 hover:bg-red-50 rounded-lg"
                                      onClick={() => {
                                        const currentEmail = camp.recipients?.[camp.currentIndex - 1] || "";
                                        if (currentEmail) {
                                          setManualUnsubscribeEmail(currentEmail);
                                          toast.info(`Email ${currentEmail} loaded to block form. Go to Anti-Spam tab.`);
                                        } else {
                                          toast.error("No recipient found for this index");
                                        }
                                      }}
                                    >
                                      <UserX className="w-3.5 h-3.5 mr-1" /> Block Last
                                    </Button>
                                    <Badge variant={camp.status === "completed" ? "secondary" : "outline"} className="text-[10px]">
                                      {camp.status === "completed" ? "Completed" : "Running"}
                                    </Badge>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                                      onClick={() => deleteCampaign(camp.id)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="text-center p-3 bg-gray-50 rounded-xl">
                                    <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">Sent</p>
                                    <p className="text-lg font-bold text-gray-900">{camp.currentIndex || 0} / {camp.totalSent}</p>
                                  </div>
                                  <div className="text-center p-3 bg-orange-50 rounded-xl">
                                    <p className="text-[10px] font-bold uppercase text-orange-400 mb-1">Date</p>
                                    <p className="text-sm font-bold text-orange-900">
                                      {camp.createdAt?.seconds ? new Date(camp.createdAt.seconds * 1000).toLocaleDateString() : "Pending"}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                  </CardContent>
                </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Column: Settings & History */}
          <div className="lg:col-span-4 space-y-8">
            <Card className="border-none shadow-xl shadow-gray-200/50 rounded-2xl bg-white/70 backdrop-blur-xl">
              <CardHeader className="border-b border-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings className="w-5 h-5 text-gray-400" />
                    <CardTitle className="text-lg">SMTP Settings</CardTitle>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-8 w-8 p-0 rounded-lg"
                    onClick={() => {
                      const name = prompt("Enter profile name:");
                      if (!name) return;
                      const newProfile: SMTPConfig = {
                        id: Math.random().toString(36).substr(2, 9),
                        name,
                        host: "",
                        port: "587",
                        user: "",
                        pass: "",
                        secure: false,
                        fromName: "Smart Mailer",
                        fromEmail: ""
                      };
                      setSmtpProfiles([...smtpProfiles, newProfile]);
                      setSelectedSmtpId(newProfile.id);
                      toast.success(`Profile "${name}" added`);
                    }}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-gray-400">Select Profile</Label>
                  <div className="flex gap-2">
                    <select 
                      className="flex-1 h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm"
                      value={selectedSmtpId}
                      onChange={(e) => setSelectedSmtpId(e.target.value)}
                    >
                      {smtpProfiles.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {smtpProfiles.length > 1 && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-9 w-9 p-0 text-red-500 rounded-lg"
                        onClick={() => {
                          if (confirm("Delete this profile?")) {
                            const filtered = smtpProfiles.filter(p => p.id !== selectedSmtpId);
                            setSmtpProfiles(filtered);
                            setSelectedSmtpId(filtered[0].id);
                            toast.success("Profile deleted");
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <Separator className="my-4 bg-gray-50" />

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-gray-400">Profile Name</Label>
                  <Input 
                    placeholder="e.g. Work SMTP" 
                    value={activeSmtp.name}
                    onChange={(e) => {
                      setSmtpProfiles(smtpProfiles.map(p => p.id === selectedSmtpId ? {...p, name: e.target.value} : p));
                    }}
                    className="border-gray-200 rounded-lg h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-gray-400">Host & Port</Label>
                  <div className="flex gap-2">
                    <Input 
                      placeholder="smtp.gmail.com" 
                      value={activeSmtp.host}
                      onChange={(e) => {
                        setSmtpProfiles(smtpProfiles.map(p => p.id === selectedSmtpId ? {...p, host: e.target.value} : p));
                      }}
                      className="border-gray-200 rounded-lg h-9 text-sm"
                    />
                    <Input 
                      placeholder="587" 
                      value={activeSmtp.port}
                      onChange={(e) => {
                        setSmtpProfiles(smtpProfiles.map(p => p.id === selectedSmtpId ? {...p, port: e.target.value} : p));
                      }}
                      className="border-gray-200 rounded-lg h-9 w-20 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-gray-400">Sender Name</Label>
                  <Input 
                    placeholder="Your Name" 
                    value={activeSmtp.fromName}
                    onChange={(e) => {
                      setSmtpProfiles(smtpProfiles.map(p => p.id === selectedSmtpId ? {...p, fromName: e.target.value} : p));
                    }}
                    className="border-gray-200 rounded-lg h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-gray-400">SMTP Username</Label>
                  <Input 
                    placeholder="user@example.com or username" 
                    value={activeSmtp.user}
                    onChange={(e) => {
                      setSmtpProfiles(smtpProfiles.map(p => p.id === selectedSmtpId ? {...p, user: e.target.value} : p));
                    }}
                    className="border-gray-200 rounded-lg h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-gray-400">Sender Email (From)</Label>
                  <Input 
                    placeholder="sender@example.com" 
                    value={activeSmtp.fromEmail}
                    onChange={(e) => {
                      setSmtpProfiles(smtpProfiles.map(p => p.id === selectedSmtpId ? {...p, fromEmail: e.target.value} : p));
                    }}
                    className="border-gray-200 rounded-lg h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-gray-400">Password / App Password</Label>
                  <div className="relative">
                    <Input 
                      type={showPassword ? "text" : "password"} 
                      placeholder="••••••••" 
                      value={activeSmtp.pass}
                      onChange={(e) => {
                        setSmtpProfiles(smtpProfiles.map(p => p.id === selectedSmtpId ? {...p, pass: e.target.value} : p));
                      }}
                      className="border-gray-200 rounded-lg h-9 text-sm pr-9"
                    />
                    <button 
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[9px] text-gray-400 leading-tight mt-1">
                    * For Gmail, use an <strong>App Password</strong>, not your regular password.
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <Label className="text-xs font-medium">SSL/TLS</Label>
                  <Switch 
                    checked={activeSmtp.secure} 
                    onCheckedChange={(val) => {
                      setSmtpProfiles(smtpProfiles.map(p => p.id === selectedSmtpId ? {...p, secure: val} : p));
                    }} 
                  />
                </div>

                <div className="pt-4">
                  <Button 
                    variant="outline" 
                    className={`w-full h-10 rounded-xl border-dashed transition-all ${
                      smtpStatus === "success" ? "border-green-500 bg-green-50 text-green-700 hover:bg-green-100" :
                      smtpStatus === "error" ? "border-red-500 bg-red-50 text-red-700 hover:bg-red-100" :
                      "border-gray-200 hover:border-orange-300 hover:bg-orange-50/50"
                    }`}
                    onClick={testSmtpConnection}
                    disabled={isTestingSmtp}
                  >
                    {isTestingSmtp ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : smtpStatus === "success" ? (
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                    ) : smtpStatus === "error" ? (
                      <AlertCircle className="w-4 h-4 mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    {isTestingSmtp ? "Testing..." : smtpStatus === "success" ? "Connection OK" : smtpStatus === "error" ? "Connection Failed" : "Test Connection"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-xl shadow-gray-200/50 rounded-2xl overflow-hidden bg-white/70 backdrop-blur-xl">
              <CardHeader className="border-b border-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-gray-400" />
                    <CardTitle className="text-lg">History</CardTitle>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-[10px] h-7 text-gray-400 hover:text-red-500"
                    onClick={clearHistory}
                  >
                    Clear All
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[400px]">
                  {history.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 text-sm">No activity yet</div>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {history.map((item) => (
                        <div key={item.id} className="p-4 hover:bg-gray-50 transition-colors group">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold truncate max-w-[120px]">{item.to}</span>
                            <div className="flex items-center gap-1">
                              {item.status === 'success' && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  title="Block this email"
                                  className="h-6 w-6 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                  onClick={() => {
                                    setManualUnsubscribeEmail(item.to);
                                    toast.info("Email loaded to block form in Anti-Spam tab");
                                  }}
                                >
                                  <UserX className="w-3 h-3" />
                                </Button>
                              )}
                              <Badge variant={item.status === "success" ? "secondary" : "destructive"} className="text-[9px] h-4">
                                {item.status}
                              </Badge>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
                                onClick={() => deleteHistoryItem(item.id)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] text-gray-500 truncate">{item.subject}</p>
                            <p className="text-[9px] text-gray-400">{new Date(item.timestamp).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
