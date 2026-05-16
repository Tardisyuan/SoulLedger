"use client";

import { useState } from "react";
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
  Settings, Sliders, Puzzle, Plug, PlugZap,
  Bookmark, BookmarkCheck, Star, StarHalf, Heart,
  Flag, Tag, Tags, Hash, AtSign,
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
  ThumbsUp, ThumbsDown, Handshake,
  TrendingUp, TrendingDown, Activity,
  Zap, ZapOff, FlashlightIcon, Battery, BatteryCharging,
  Wifi, WifiOff, WifiHigh, Signal, Radio,
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
  Terminal, TerminalSquare, Code, Code2, CodeSquare,
  FileCode, FileJson, FileSpreadsheet,
  Scroll, ScrollText, BookOpen, Book, BookCheck, BookX,
  Building, Building2, Store, Warehouse,
  Castle, Church, Landmark,
  Briefcase, Ticket, TicketCheck, TicketPercent,
  CreditCard, Wallet, Receipt, ReceiptCent,
  ShoppingCart, ShoppingBag, Gift, Ribbon, Medal,
  FlagOff, Ban,
  PanelLeft, PanelRight, PanelTop, PanelBottom,
  Focus, Target, Crosshair, MousePointer, MousePointerClick,
  Move, MoveDiagonal, MoveHorizontal, MoveVertical,
  Settings2,
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
import { BaseModal } from "@/src/components/ui/Modal";

interface IconPickerProps {
  value: string;
  onChange: (iconName: string) => void;
}

interface IconCategory {
  label: string;
  icons: LucideIcon[];
}

const ICON_CATEGORIES: IconCategory[] = [
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

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("navigation");
  const [search, setSearch] = useState("");

  // Find the selected icon component
  let SelectedIcon: LucideIcon | null = null;
  if (value) {
    for (const cat of ICON_CATEGORIES) {
      const found = cat.icons.find((icon) => icon.displayName === value);
      if (found) {
        SelectedIcon = found;
        break;
      }
    }
  }

  // Search across all icons
  const searchResults = search
    ? ICON_CATEGORIES.flatMap((c) => c.icons).filter((icon) =>
        icon.displayName?.toLowerCase().includes(search.toLowerCase())
      )
    : [];

  const displayCategory = ICON_CATEGORIES.find((c) => c.label === activeCategory);
  const displayIcons = search ? searchResults : (displayCategory?.icons ?? []);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md text-sm text-[hsl(var(--color-ink))] hover:border-[hsl(var(--color-accent))] transition-colors min-w-[120px]"
        >
          {SelectedIcon ? (
            <SelectedIcon className="w-4 h-4 text-amber-400" />
          ) : (
            <span className="text-[hsl(var(--color-ink-muted))]">选择图标</span>
          )}
          {value && <span className="text-[hsl(var(--color-ink-subtle))] ml-auto text-xs">{value}</span>}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[hsl(var(--color-ink-muted))] hover:text-red-400 text-xs"
          >
            清除
          </button>
        )}
      </div>

      <BaseModal
        isOpen={isOpen}
        onClose={() => { setIsOpen(false); setSearch(""); }}
        title="选择图标"
      >
        <div className="space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索图标..."
            className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />

          {!search && (
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
              {ICON_CATEGORIES.map((cat) => (
                <button
                  key={cat.label}
                  type="button"
                  onClick={() => setActiveCategory(cat.label)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    activeCategory === cat.label
                      ? "bg-amber-500 text-black"
                      : "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-8 gap-1 max-h-64 overflow-y-auto">
            {displayIcons.map((icon) => {
              const isSelected = value === icon.displayName;
              return (
                <button
                  key={icon.displayName}
                  type="button"
                  onClick={() => {
                    if (icon.displayName) onChange(icon.displayName);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  title={icon.displayName ?? ""}
                  className={`flex items-center justify-center w-9 h-9 rounded transition-colors ${
                    isSelected
                      ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500"
                      : "text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] hover:text-[hsl(var(--color-ink))]"
                  }`}
                >
                  {(() => {
                    const Icon = icon as LucideIcon;
                    return <Icon className="w-4 h-4" />;
                  })()}
                </button>
              );
            })}
          </div>

          {displayIcons.length === 0 && (
            <p className="text-center text-[hsl(var(--color-ink-muted))] text-sm py-4">没有找到图标</p>
          )}
        </div>
      </BaseModal>
    </>
  );
}
