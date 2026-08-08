import { MESSAGE_TYPES } from "../shared/defaults.js";

function pageActionMessage(action) {
  return {
    action,
    type: MESSAGE_TYPES.PAGE_ACTION
  };
}

function responseError(response) {
  return new Error(response?.error || "The page action was not acknowledged.");
}

async function trySendPageAction(sendMessage, tabId, action) {
  try {
    return await sendMessage(tabId, pageActionMessage(action));
  } catch {
    return null;
  }
}

export async function dispatchPageAction({
  action,
  injectContentScript,
  sendMessage,
  tabId
}) {
  const existingResponse = await trySendPageAction(sendMessage, tabId, action);
  if (existingResponse?.ok) {
    return existingResponse;
  }
  if (existingResponse?.ok === false) {
    throw responseError(existingResponse);
  }

  await injectContentScript();

  const injectedResponse = await trySendPageAction(sendMessage, tabId, action);
  if (injectedResponse?.ok) {
    return injectedResponse;
  }
  if (injectedResponse?.ok === false) {
    throw responseError(injectedResponse);
  }

  const legacyResponse = await sendMessage(tabId, {
    action,
    type: "page-action"
  });
  if (!legacyResponse?.ok) {
    throw responseError(legacyResponse);
  }

  return legacyResponse;
}
