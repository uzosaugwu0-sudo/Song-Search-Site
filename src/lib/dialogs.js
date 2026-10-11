// Site-styled replacements for window.confirm / window.prompt, built on <dialog>.
// Browser only. Falls back to the native pop-ups where <dialog> isn't supported.
import { cleanSectionName, MAX_SECTION_NAME_LENGTH } from './sections.js';

function openDialog({ message, value, maxLength, confirmLabel, danger, withInput }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'site-dialog';

    const form = document.createElement('form');
    form.method = 'dialog';

    const text = document.createElement('p');
    text.textContent = message;
    form.appendChild(text);

    let field = null;
    if (withInput) {
      field = document.createElement('input');
      field.type = 'text';
      field.className = 'input';
      field.value = value;
      field.maxLength = maxLength;
      field.setAttribute('aria-label', message);
      form.appendChild(field);
    }

    const actions = document.createElement('div');
    actions.className = 'site-dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => dialog.close('cancel'));
    actions.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.type = 'submit';
    okBtn.value = 'ok';
    okBtn.textContent = confirmLabel;
    okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    actions.appendChild(okBtn);

    form.appendChild(actions);
    dialog.appendChild(form);

    // Clicking the dimmed backdrop (the dialog element itself) cancels.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close('cancel');
    });
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'ok';
      const answer = field ? (confirmed ? field.value : null) : confirmed;
      dialog.remove();
      resolve(answer);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    if (field) {
      field.focus();
      field.select();
    } else {
      cancelBtn.focus();
    }
  });
}

export function confirmDialog(message, { confirmLabel = 'OK', danger = false } = {}) {
  if (typeof HTMLDialogElement === 'undefined') return Promise.resolve(window.confirm(message));
  return openDialog({ message, confirmLabel, danger, withInput: false });
}

export function promptDialog(message, { value = '', maxLength } = {}) {
  if (typeof HTMLDialogElement === 'undefined') return Promise.resolve(window.prompt(message, value));
  return openDialog({ message, value, maxLength, confirmLabel: 'Save', danger: false, withInput: true });
}

// Resolves to a cleaned section name, or null if cancelled or empty.
export async function askSectionName(current = '') {
  const answer = await promptDialog('Section name (e.g. Opening Worship, Praise, Closing Worship)', {
    value: current,
    maxLength: MAX_SECTION_NAME_LENGTH,
  });
  return cleanSectionName(answer);
}
