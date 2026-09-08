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
  } catch (error) {
    if (/receiving end does not exist|could not establish connection/i.test(error?.message || "")) {
      return null;
    }
    throw error;
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

  const injectedResponse = await sendMessage(tabId, pageActionMessage(action));
  if (injectedResponse?.ok) {
    return injectedResponse;
  }
  throw responseError(injectedResponse);
}
