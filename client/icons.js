import { createElement, Plus, Search, FolderOpen, Folders, Clapperboard, MessageCircle, History, SlidersHorizontal, Settings2, Layers, ChevronDown, Plug, Share2, Folder, SquarePen, Maximize2, X, Sparkles, ArrowUp, Text, Image, Video, AudioLines, Box, Upload, Map, Workflow, Grid2X2, Copy, Download, Trash2, Play, Square, Minus, Focus, RotateCcw, ChevronLeft, ChevronRight, Check, Link, ArrowDownToLine, Brain, Lightbulb, ArrowRight, LayoutList, Hand, Circle, Mic, Ellipsis, MousePointer2, RefreshCw, CircleHelp } from 'lucide';
const LayoutOverview = [['rect', {x:3,y:3,width:18,height:5,rx:1}],['rect', {x:3,y:12,width:5,height:9,rx:1}],['path', {d:'M12 13h9M12 17h9M12 21h9'}]];
const icons = { Plus, Search, FolderOpen, Folders, LayoutOverview, Clapperboard, MessageCircle, History, SlidersHorizontal, Settings2, Layers, ChevronDown, Plug, Share2, Folder, SquarePen, Maximize2, X, Sparkles, ArrowUp, Text, Image, Video, AudioLines, Box, Upload, Map, Workflow, Grid2X2, Copy, Download, Trash2, Play, Square, Minus, Focus, RotateCcw, ChevronLeft, ChevronRight, Check, Link, ArrowDownToLine, Brain, Lightbulb, ArrowRight, LayoutList, Hand, Circle, Mic, Ellipsis, MousePointer2, RefreshCw, CircleHelp };
function icon(name) {
    const key = name.replace(/(^|-)([a-z0-9])/g, (_, dash, letter) => letter.toUpperCase());
    const component = icons[key] || icons[Object.keys(icons).find(candidate => candidate.toLowerCase() === key.toLowerCase())] || icons.Box;
    const node = createElement(component, { class: 'lucide', 'aria-hidden': 'true', focusable: 'false' });
    return node;
}
function render(root = document) {
    const elements = [...root.querySelectorAll('[data-icon]')];
    if (root.matches?.('[data-icon]')) elements.unshift(root);
    for (const element of elements) {
        if (!element.querySelector('svg')) element.appendChild(icon(element.dataset.icon));
    }
}
window.CanvasIcons = { icon, render };
