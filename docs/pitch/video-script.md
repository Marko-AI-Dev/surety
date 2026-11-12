# Surety: the 3-minute video and the 5-minute pitch

Written 12 Nov 2026 for the W3NODE submission (video of up to 3 minutes, pitch of 5 minutes plus 3 of questions). Every number below comes from `evidence/`. Anything in [square brackets] is yours to fill in and must not be invented.

## The one idea

**AI agents can do the buying. They cannot take the money.** Everything in the video shows one half of that sentence or the other.

## The 3-minute video

Record the screen at 1920 x 1080 with the app open as `http://localhost:5173`. Use a real live run if one goes cleanly. If not, play the recording "Paid: the inspector confirmed" and leave the "Recorded" badge on screen; do not crop it out.

About 390 spoken words. Read it slowly; do not add to it.

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:15 | Black, then one line of text: "Would you give an AI agent your company's bank account?" | "AI agents can already find suppliers and negotiate prices. Nobody lets them pay, because an agent can be tricked, and a tricked agent with a wallet is a theft." |
| 0:15 to 0:30 | The Purchase screen at the start of a run. Point at the brief. | "This is Surety. A person sets what to buy, the most to pay and who the approved suppliers are. Three AI agents do the rest. They can talk and choose. They cannot move money." |
| 0:30 to 0:55 | Conversations filling in. The "Price per unit" number dropping. | "Here they are negotiating with real suppliers. Watch the price: the opening offer was 118 dollars a panel, and the best is now 111. Nothing said in this chat can move a cent." |
| 0:55 to 1:20 | The 9 Nov recording, Coastline's lane: yellow card, then red card, then "Removed". | "One supplier tries to trick the agent: approve without checks, pay our new wallet. Surety reads every message before any agent does. That one is stopped, and the supplier is out. The agents never saw it." |
| 1:20 to 1:45 | Back to the main run. The Lead's decision, then "Locked on the ledger" and the Lock link. Click it: testnet.xrpl.org opens. | "The lead agent picks a supplier and gives its reason. Then the money locks in escrow on the XRP Ledger. Not in our database. On the ledger, where anyone can see it, and where only two things can happen to it." |
| 1:45 to 2:15 | A phone in hand: the inspector's page. Type the number, "You read SZXDUR-77290. Send?", confirm. Cut to the big screen: Inspector step turns done, then Paid, with the Payment link. | "The first: a person, not an agent, checks the shipment and confirms it from a phone. That is the second key. The paperwork matches, and the supplier is paid 46,400 dollars." |
| 2:15 to 2:35 | The recording "Refunded: the inspector refused". The Inspector step turns red, then Refunded with its link. | "The second: the inspector says no. Seal broken, 380 cartons, not 400. Nothing is paid, and the ledger sends the money back. Surety does not have to be online for that. It is the ledger's rule." |
| 2:35 to 2:50 | The Attack lab: "15 real attempts to cheat the system. None got through." | "We tried to break it fifteen ways on the test ledger. Wrong wallet, edited documents, a runaway agent, a cap raised with the wrong key. None got through. No money reached an attacker." |
| 2:50 to 3:00 | The line again, then the repo address. | "AI agents that can buy for your business, and cannot steal from it. Surety, on the XRP Ledger." |

### Shots to get before you edit

1. The Purchase screen from the first second of a run to "Paid", in one take, no cuts. Everything else is cut from this.
2. The inspector's phone, filmed over the shoulder, with the big screen visible behind it if you can.
3. The explorer page for the lock and for the payment, each open for three seconds.
4. The refused recording from the lock to "Refunded".
5. The Attack lab header.

### Rules for the edit

- Never show a recording as live. The badge stays.
- Never call the decision model deterministic, and do not name its vendor in the video.
- Say "test dollars" once, early. The amounts are TESTUSD on XRPL Testnet.
- No music louder than the voice. No stock footage.

## The 5-minute pitch

| Minute | What you do | The point |
|---|---|---|
| 0:00 to 0:45 | The question, then the pain: an importer pays first and risks losing the money, or the supplier ships first and risks not being paid. Banks solve it with a letter of credit that small importers [cannot get / cannot afford: cite one source]. | A real customer pain, as the track asks |
| 0:45 to 3:15 | The live run on the big screen. You talk over it; do not wait in silence. Hand the inspector's phone to a judge when the money locks. | The agent executes the transaction; a person holds the second key |
| 3:15 to 3:45 | Control room: the limits, set by a person. Say what happens when an agent asks for more: the signer refuses. | Limits enforced outside the agent, set by a human |
| 3:45 to 4:30 | Who pays for this and how you reach them: [first customer type], [price per deal], [the one real conversation you had]. | Business: a third of the score |
| 4:30 to 5:00 | Why the XRP Ledger: native escrow, no smart contract, a refund that needs nobody. RLUSD: the testnet issuer has escrow switched off, so the demo uses a test dollar on the same mechanism; it is a change of issuer. | Meaningful use of XRPL and RLUSD |

If the live run stalls for more than 20 seconds, switch to "Recorded" and say so: "This is the same purchase, recorded yesterday on testnet." Then carry on.

## The questions you will get

| Question | Answer in one breath |
|---|---|
| What stops the agent reading your keys? | The agents run sandboxed and cannot see the drive that holds them (fixed on 10 Nov). The signer is a separate process with its own secrets, and the agents only hold API tokens. |
| What does the escrow buy the buyer? | Until 10 Nov, not enough: the supplier confirmed its own paperwork. Now an independent person must confirm the shipment, and we have a recorded refund where they refused. |
| Who is the inspector in real life? | A freight forwarder, an inspection company or the buyer's own receiving clerk. The roadmap is the carrier's own signed shipping record. |
| Where is RLUSD? | Its testnet issuer has escrow off. We checked on the ledger and used a test dollar on the same trust-line escrow. Moving to RLUSD is a change of issuer once it is enabled. |
| What if your model vendor is down? | Nothing is paid. The deal is held and the ledger refunds at the deadline. We have that run recorded. |
| Why not a smart contract? | The ledger's own escrow already does lock, release on a condition, and refund by time. Less code holds the money. |
| What can a stolen agent token do? | Lock money, within the limits, to an approved supplier. It cannot release it: that takes the paperwork and the inspector. |
| Is this deployed? | The ledger side runs on XRPL Testnet with public transactions. [Say where the app is hosted, if it is.] |

## What only you can do before Friday

1. One real conversation with an importer, freight forwarder or clearing agent. Quote them in minute four.
2. One sourced figure for the cost or delay of a letter of credit. Without a source, leave the number out.
3. Ask a mentor whether "testnet deployment" means the transactions or a hosted app.
4. Rehearse the pitch twice with the phone handover, once on a hotspot.
