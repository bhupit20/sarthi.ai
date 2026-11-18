/**
 * Decides, without asking the AI, whether something the client said needs a
 * reply from the owner. Everything does, except pure small talk: greetings,
 * thanks and acknowledgements such as "okay", "sounds good", "no rush".
 *
 * A remark counts as small talk only when it is short and made entirely of
 * small-talk words, so any real content ("the logo looks small", "I haven't
 * checked the links") gets a reply. "Suggest now" always overrides this.
 */
const SMALL_TALK_WORDS = new Set(
  `
  ok okay okey alright allright right sure yes yeah yep yup ya no nope nah
  mm mmm hmm mhm uh um ah oh aha haha ha lol
  thanks thank thankyou cheers appreciate appreciated
  you so much very really a lot lots
  great good perfect awesome nice cool fine wonderful excellent brilliant amazing lovely super fantastic
  sounds that this works work for to me it is was makes make sense got i see understood understand noted
  agreed agree absolutely exactly definitely totally indeed of course
  hello hi hey there everyone all guys morning afternoon evening good day
  bye goodbye talk soon see later take care catch up
  rush hurry your time worries problem problems
  welcome pleasure
  `
    .split(/\s+/)
    .filter(Boolean),
);

/** Longer remarks are never treated as small talk. */
const MAX_SMALL_TALK_WORDS = 8;

export function needsReply(text: string): boolean {
  const remark = text.trim();
  if (!remark) return false;
  if (remark.includes('?')) return true;
  const words = remark
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 0) return false;
  if (words.length > MAX_SMALL_TALK_WORDS) return true;
  return !words.every((word) => SMALL_TALK_WORDS.has(word));
}
