import { normalizeProject } from './model.js';
import { downloadBlob } from './export.js';

const KEY = 'plarail-seal-project-v1';
let timer = null;

export function saveLocal(project) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(project)); } catch (e) { /* 容量超過など */ }
  }, 300);
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeProject(JSON.parse(raw)) : null;
  } catch (e) { return null; }
}

export function clearLocal() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function exportProjectJSON(project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'plarail_seal_project.json');
}

export function readProjectFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(normalizeProject(JSON.parse(r.result))); } catch (e) { reject(e); }
    };
    r.onerror = reject;
    r.readAsText(file);
  });
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
