import {
  Home, Menu, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, CornerDownLeft, CornerDownRight,
  ArrowUpRight, ArrowDownLeft, ExternalLink, Link, RefreshCw,
  User, Users, UserPlus, UserCheck, UserX,
  Bell, BellRing, Calendar, Clock, Mail, Inbox,
  Settings, Sliders, Puzzle, Plug,
  Bookmark, Star, Heart, Flag, Tag, Hash, AtSign,
  Plus, Minus, X, Check, Search, Filter, SortAsc, SortDesc,
  Edit, Edit2, Edit3, Pencil, Trash, Trash2, Copy, Clipboard,
  Download, Upload, Save, Share, Share2,
  ZoomIn, ZoomOut, Maximize2, Minimize2, Eye, EyeOff,
  Lock, Unlock, Key, Shield, ShieldCheck, ShieldAlert,
  CheckCircle, CheckCircle2, XCircle, AlertCircle, AlertTriangle,
  Info, HelpCircle, MessageSquare, MessageCircle,
  ThumbsUp, ThumbsDown, TrendingUp, TrendingDown,
  Activity, Zap, FlashlightIcon, Battery, Wifi, WifiOff,
  Skull, Ghost, Sparkles, Wand, Flame, Droplet,
  Sun, Moon, Cloud, Wind, Feather, Leaf,
  Scale, Award, Crown, Gem, Swords,
  Anchor, Sailboat, Compass, Map, Globe, Plane,
  File, FileText, FileCheck, FileX, Folder, FolderOpen,
  FolderPlus, Archive, Package, Box, Database,
  HardDrive, Server, Cpu, Monitor, Smartphone,
  Layout, Grid, List, Sidebar, Columns, Layers,
  KeyRound, LockKeyhole, ShieldPlus, ShieldMinus,
  UserCog, UsersRound,
  Building, Building2, Store,
  BarChart, BarChart2, PieChart,
  Terminal, Code, Code2, FileCode, FileJson,
  Scroll, BookOpen,
  ArrowRightLeft,
  House, PanelsTopLeft, LayoutDashboard,
  type LucideIcon,
} from "lucide-react";

// All available icons for lookup
const ALL_ICONS: LucideIcon[] = [
  Home, Menu, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, CornerDownLeft, CornerDownRight,
  ArrowUpRight, ArrowDownLeft, ExternalLink, Link, RefreshCw,
  User, Users, UserPlus, UserCheck, UserX,
  Bell, BellRing, Calendar, Clock, Mail, Inbox,
  Settings, Sliders, Puzzle, Plug,
  Bookmark, Star, Heart, Flag, Tag, Hash, AtSign,
  Plus, Minus, X, Check, Search, Filter, SortAsc, SortDesc,
  Edit, Edit2, Edit3, Pencil, Trash, Trash2, Copy, Clipboard,
  Download, Upload, Save, Share, Share2,
  ZoomIn, ZoomOut, Maximize2, Minimize2, Eye, EyeOff,
  Lock, Unlock, Key, Shield, ShieldCheck, ShieldAlert,
  CheckCircle, CheckCircle2, XCircle, AlertCircle, AlertTriangle,
  Info, HelpCircle, MessageSquare, MessageCircle,
  ThumbsUp, ThumbsDown, TrendingUp, TrendingDown,
  Activity, Zap, FlashlightIcon, Battery, Wifi, WifiOff,
  Skull, Ghost, Sparkles, Wand, Flame, Droplet,
  Sun, Moon, Cloud, Wind, Feather, Leaf,
  Scale, Award, Crown, Gem, Swords,
  Anchor, Sailboat, Compass, Map, Globe, Plane,
  File, FileText, FileCheck, FileX, Folder, FolderOpen,
  FolderPlus, Archive, Package, Box, Database,
  HardDrive, Server, Cpu, Monitor, Smartphone,
  Layout, Grid, List, Sidebar, Columns, Layers,
  KeyRound, LockKeyhole, ShieldPlus, ShieldMinus,
  UserCog, UsersRound,
  Building, Building2, Store,
  BarChart, BarChart2, PieChart,
  Terminal, Code, Code2, FileCode, FileJson,
  Scroll, BookOpen,
  ArrowRightLeft,
  House, PanelsTopLeft, LayoutDashboard,
];

// Object-based icon lookup for compatibility
const ICON_LOOKUP: Record<string, LucideIcon> = {};
for (const icon of ALL_ICONS) {
  if (icon.displayName) {
    ICON_LOOKUP[icon.displayName] = icon;
  }
}

// Default fallback icon
const DEFAULT_ICON = Settings;

/**
 * Look up a Lucide icon by its displayName (e.g., "Home", "Settings", "Bell")
 * Returns the icon component or the default fallback if not found
 */
export function getIconByName(name: string | null | undefined): LucideIcon {
  if (!name) return DEFAULT_ICON;
  return ICON_LOOKUP[name] || DEFAULT_ICON;
}

/**
 * Get all available icon displayNames (for autocomplete, validation, etc.)
 */
export function getAllIconNames(): string[] {
  return Object.keys(ICON_LOOKUP).sort();
}

export { DEFAULT_ICON };
