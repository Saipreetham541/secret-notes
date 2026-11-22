// Opening the photo/file picker hides the page on phones. Without this, the
// "lock when the tab is hidden" rule would lock the vault mid-attach.
let allowHideUntil = 0;
export function allowPickerHide() {
  allowHideUntil = Date.now() + 3 * 60 * 1000;
}
export function endPickerHide() {
  allowHideUntil = 0;
}
export const hideAllowed = () => Date.now() < allowHideUntil;
