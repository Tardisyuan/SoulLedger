/**
 * IconPicker 的图标白名单(分类即选择器里的标签页)。单独成文件是因为侧栏的静态图标表
 * (`src/lib/menuIcons.ts`)也读它 —— 侧栏在外框首屏包里,不能为了这张表把选择器的弹层一起拉进去。
 */
import {
  Home, Menu, ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUpRight, ArrowDownLeft, ArrowRightLeft, ArrowUpDown,
  ExternalLink, Link, RefreshCw, RotateCw, RotateCcw,
  User, Users, UserPlus, UserCheck, UserX, UserCog, UsersRound,
  Bell, BellRing, BellDot, BellOff,
  Calendar, CalendarCheck, CalendarClock, CalendarX,
  Clock, Timer, Hourglass,
  Mail, MailOpen, Inbox, MessageSquare, MessageCircle,
  Heart,
  Flag,
  Plus, Minus, PlusCircle, MinusCircle, X, Check, CheckCheck,
  Search, SearchCheck, Filter, SortAsc, SortDesc,
  Edit, Edit2, Edit3, Pencil, Trash, Trash2, Copy, Clipboard,
  ClipboardCheck, ClipboardList, ClipboardPaste,
  Download, DownloadCloud, Upload, UploadCloud, Save, Share, Share2,
  ZoomIn, ZoomOut, Maximize2, Minimize2, Eye, EyeOff,
  Lock, Unlock, LockKeyhole, Key, KeyRound,
  Shield, ShieldCheck, ShieldAlert, ShieldQuestion, ShieldPlus, ShieldMinus,
  CheckCircle, CheckCircle2, CheckSquare, Square,
  XCircle, CircleDot, XSquare,
  AlertCircle, AlertTriangle, AlertOctagon, Info, HelpCircle,
  TrendingUp, TrendingDown, Activity,
  Zap,
  Skull, Ghost, Sparkles, Wand, Wand2, Flame,
  Sun, SunDim, Moon, Cloud, CloudSun, CloudMoon,
  Wind, Feather, Leaf, LeafyGreen, TreePine, Flower, Flower2,
  Scale, Award, Crown, Gem, Diamond, Swords, Sword, Axe,
  Anchor, Sailboat, Compass, Map, MapPin,
  Globe, GlobeLock, Plane, PlaneTakeoff, Rocket,
  File, FileText, FileCheck, FileX, FileSearch, FileWarning,
  Folder, FolderOpen, FolderPlus, FolderCheck, FolderX, FolderTree,
  Archive, Package, PackageOpen, HardDrive, Server, Cpu, Monitor, Smartphone,
  Layout, Grid, Grid2X2, List, ListChecks, ListTodo,
  House, PanelsTopLeft, LayoutDashboard,
  SidebarOpen, SidebarClose, Columns, Columns3, Layers, Layers2,
  BarChart, BarChart2, BarChart3, BarChart4,
  PieChart, ActivitySquare, LineChart,
  Building, Building2, Store, Warehouse,
  Castle, Church, Landmark,
  Briefcase, Ticket, TicketCheck, TicketPercent,
  CreditCard, Wallet, Receipt, ReceiptCent,
  ShoppingCart, ShoppingBag, Gift, Ribbon, Medal,
  FlagOff, Ban,
  PanelLeft, PanelRight, PanelTop, PanelBottom,
  Focus, Target, Crosshair, MousePointer, MousePointerClick,
  Move, MoveDiagonal, MoveHorizontal, MoveVertical,
  Send, SendHorizontal,
  Phone, PhoneCall, PhoneIncoming, PhoneOutgoing,
  Video, VideoOff, Camera, Mic, MicOff, Volume,
  Play, Pause, SkipBack, SkipForward, Repeat, Shuffle,
  FastForward, Rewind,
  Music, Disc,
  Mountain, Tent,
  History, Watch,
  type LucideIcon,
} from "lucide-react";

/**
 * The same icons by EXPORT name. A row saved by an older picker holds the export name (`Home`),
 * a fresh pick holds the displayName (`House`, the canonical icon `Home` aliases); the menu icon
 * table (`src/lib/menuIcons.ts`) keys both.
 */
export const PICKER_ICONS: Record<string, LucideIcon> = {
  Home, Menu, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUpRight, ArrowDownLeft, ArrowRightLeft, ArrowUpDown, ExternalLink, Link, RefreshCw, RotateCw, RotateCcw, User,
  Users, UserPlus, UserCheck, UserX, UserCog, UsersRound, Bell, BellRing, BellDot, BellOff,
  Calendar, CalendarCheck, CalendarClock, CalendarX, Clock, Timer, Hourglass, Mail, MailOpen, Inbox,
  MessageSquare, MessageCircle, Heart, Flag, Plus, Minus, PlusCircle, MinusCircle, X, Check,
  CheckCheck, Search, SearchCheck, Filter, SortAsc, SortDesc, Edit, Edit2, Edit3, Pencil,
  Trash, Trash2, Copy, Clipboard, ClipboardCheck, ClipboardList, ClipboardPaste, Download, DownloadCloud, Upload,
  UploadCloud, Save, Share, Share2, ZoomIn, ZoomOut, Maximize2, Minimize2, Eye, EyeOff,
  Lock, Unlock, LockKeyhole, Key, KeyRound, Shield, ShieldCheck, ShieldAlert, ShieldQuestion, ShieldPlus,
  ShieldMinus, CheckCircle, CheckCircle2, CheckSquare, Square, XCircle, CircleDot, XSquare, AlertCircle, AlertTriangle,
  AlertOctagon, Info, HelpCircle, TrendingUp, TrendingDown, Activity, Zap, Skull, Ghost, Sparkles,
  Wand, Wand2, Flame, Sun, SunDim, Moon, Cloud, CloudSun, CloudMoon, Wind,
  Feather, Leaf, LeafyGreen, TreePine, Flower, Flower2, Scale, Award, Crown, Gem,
  Diamond, Swords, Sword, Axe, Anchor, Sailboat, Compass, Map, MapPin, Globe,
  GlobeLock, Plane, PlaneTakeoff, Rocket, File, FileText, FileCheck, FileX, FileSearch, FileWarning,
  Folder, FolderOpen, FolderPlus, FolderCheck, FolderX, FolderTree, Archive, Package, PackageOpen, HardDrive,
  Server, Cpu, Monitor, Smartphone, Layout, Grid, Grid2X2, List, ListChecks, ListTodo,
  House, PanelsTopLeft, LayoutDashboard, SidebarOpen, SidebarClose, Columns, Columns3, Layers, Layers2, BarChart,
  BarChart2, BarChart3, BarChart4, PieChart, ActivitySquare, LineChart, Building, Building2, Store, Warehouse,
  Castle, Church, Landmark, Briefcase, Ticket, TicketCheck, TicketPercent, CreditCard, Wallet, Receipt,
  ReceiptCent, ShoppingCart, ShoppingBag, Gift, Ribbon, Medal, FlagOff, Ban, PanelLeft, PanelRight,
  PanelTop, PanelBottom, Focus, Target, Crosshair, MousePointer, MousePointerClick, Move, MoveDiagonal, MoveHorizontal,
  MoveVertical, Send, SendHorizontal, Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, Video, VideoOff, Camera,
  Mic, MicOff, Volume, Play, Pause, SkipBack, SkipForward, Repeat, Shuffle, FastForward,
  Rewind, Music, Disc, Mountain, Tent, History, Watch,
};

export interface IconCategory {
  label: string;
  icons: LucideIcon[];
}

export const ICON_CATEGORIES: IconCategory[] = [
  {
    label: "navigation",
    icons: [
      Home, Menu, ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
      ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
      ArrowUpRight, ArrowDownLeft, ArrowRightLeft, ArrowUpDown,
      ExternalLink, Link, RefreshCw, RotateCw, RotateCcw,
      PanelLeft, PanelRight, PanelTop, PanelBottom,
      SidebarOpen, SidebarClose,
      House, PanelsTopLeft, LayoutDashboard,
    ],
  },
  {
    label: "users",
    icons: [
      User, Users, UserPlus, UserCheck, UserX, UserCog, UsersRound,
      Building, Building2,
    ],
  },
  {
    label: "notifications",
    icons: [
      Bell, BellRing, BellDot, BellOff,
      Mail, MailOpen, Inbox, MessageSquare, MessageCircle,
      Phone, PhoneCall, PhoneIncoming, PhoneOutgoing,
    ],
  },
  {
    label: "actions",
    icons: [
      Plus, Minus, PlusCircle, MinusCircle, X, Check, CheckCheck,
      Search, SearchCheck, Filter, SortAsc, SortDesc,
      Edit, Edit2, Edit3, Pencil,
      Trash, Trash2, Copy, Clipboard, ClipboardCheck, ClipboardList, ClipboardPaste,
      Download, DownloadCloud, Upload, UploadCloud, Save, Share, Share2,
      Send, SendHorizontal,
    ],
  },
  {
    label: "view",
    icons: [
      Eye, EyeOff, ZoomIn, ZoomOut, Maximize2, Minimize2,
      Focus, Target, Crosshair, MousePointer, MousePointerClick,
      Move, MoveDiagonal, MoveHorizontal, MoveVertical,
    ],
  },
  {
    label: "status",
    icons: [
      CheckCircle, CheckCircle2, CheckSquare, Square,
      XCircle, CircleDot, XSquare,
      AlertCircle, AlertTriangle, AlertOctagon, Info, HelpCircle,
      ShieldAlert, ShieldQuestion,
      Activity, Zap,
    ],
  },
  {
    label: "security",
    icons: [
      Lock, Unlock, LockKeyhole, Key, KeyRound,
      Shield, ShieldCheck, ShieldPlus, ShieldMinus,
      Eye, EyeOff,
      Ban,
    ],
  },
  {
    label: "soul",
    icons: [
      Skull, Ghost, Sparkles, Wand, Wand2, Flame,
      Sun, SunDim, Moon, Cloud, CloudSun, CloudMoon,
      Wind, Feather, Leaf, LeafyGreen,
      Scale, Award, Crown, Gem, Diamond, Swords, Sword, Axe,
      Heart,
      Flower, Flower2, TreePine,
    ],
  },
  {
    label: "travel",
    icons: [
      Anchor, Sailboat, Compass, Map, MapPin,
      Globe, GlobeLock, Plane, PlaneTakeoff, Rocket,
      Mountain, Tent,
      Flag, FlagOff,
    ],
  },
  {
    label: "files",
    icons: [
      File, FileText, FileCheck, FileX, FileSearch, FileWarning,
      Folder, FolderOpen, FolderPlus, FolderCheck, FolderX, FolderTree,
      Archive, Package, PackageOpen, HardDrive, Server, Cpu, Monitor, Smartphone,
      Layout, Grid, Grid2X2, List, ListChecks, ListTodo,
      Columns, Columns3, Layers, Layers2,
    ],
  },
  {
    label: "charts",
    icons: [
      BarChart, BarChart2, BarChart3, BarChart4,
      PieChart, ActivitySquare, LineChart,
      TrendingUp, TrendingDown,
    ],
  },
  {
    label: "admin",
    icons: [
      Building, Building2, Store, Warehouse,
      Castle, Church, Landmark,
      Briefcase, Ticket, TicketCheck, TicketPercent,
      CreditCard, Wallet, Receipt, ReceiptCent,
      ShoppingCart, ShoppingBag, Gift, Ribbon, Medal,
    ],
  },
  {
    label: "time",
    icons: [
      Calendar, CalendarCheck, CalendarClock, CalendarX,
      Clock, Timer, Hourglass,
      History, Watch,
    ],
  },
  {
    label: "media",
    icons: [
      Play, Pause, SkipBack, SkipForward, Repeat, Shuffle,
      FastForward, Rewind,
      Video, VideoOff, Camera, Mic, MicOff, Volume,
      Music, Disc,
    ],
  },
];
