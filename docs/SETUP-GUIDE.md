# KAP Tracker — Setup Guide

Shuru se aakhir tak: domain se lekar campaign chalne tak.

Kram wahi rakhein jo yahan diya hai. Har cheez apne se pehle wali par tiki hai.

---

## Pehle ye samajh lijiye

Ek grahak ka safar aisa hota hai:

```
Facebook ad
   ↓
/c/my-campaign        ← tracker ne click likhi, ek clickid banaya
   ↓
Landing page          ← track.js ne "aaya" gina
   ↓  (button dabaya)
/click                ← "button dabaya" gina, offer par bheja
   ↓
Offer                 ← clickid network ko diya
   ↓  (sale hui)
/postback             ← network ne khabar di
```

Poora tracker isi ek dhaage par tika hai: **`clickid`**.

Ye ek pehchan number hai jo click banate hi milta hai, offer tak jaata hai, aur sale hone par wapas aata hai. Jahan ye chhoot gaya, wahin se aapki reporting toot jaayegi.

---

## 1. Traffic domain

**Kaam:** wo naam jis par aapke saare tracking link banenge.

**Kya karna hai**

1. Traffic domain → naya domain jodiye
2. Sirf **third-level** domain chalega — `track.example.com` ✅, `example.com` ❌
3. Apne DNS me CNAME record banaiye, jo tracker bataata hai
4. Wapas aakar **Verify** dabaiye

**Status ka matlab**

| Status | Matlab |
|---|---|
| pending | DNS abhi nahi mila. Thoda ruk kar dobara Verify karein |
| active | Domain taiyaar hai |

DNS ko phailne me kabhi-kabhi kuch ghante lagte hain. "Pending" ka matlab hamesha galti nahi — thodi der baad phir dekh lijiye.

**Root redirect URL** (optional): koi seedha `https://track.example.com` khole to kahan bheja jaaye. Khaali chhodenge to 404 aayega.

---

## 2. Traffic channel

**Kaam:** ad platform ke values tracker tak laana.

**Kya karna hai**

Traffic Channels → **New From Template** → Google Ads ya Meta chuniye.

Parameters pehle se bhare milenge. Chhedne ki zarurat nahi.

**Yahan ho kya raha hai**

Har row kehti hai: "platform is naam se ye value bhejega".

```
sub3   {{campaign.id}}   campaign_id   Cid
```

Matlab — Meta `sub3` me campaign ka id bhejega, aur tracker use "Cid" wale khaane me rakhega. Isi wajah se reports me aapko campaign, ad set aur ad alag-alag dikhte hain.

**Role kya hai:** role batata hai ki value **kis khaane me jaayegi**. Role na do to value sirf `sub3` me padi rahegi — dikhegi, par report me alag column nahi banegi.

---

## 3. Offer source

**Kaam:** affiliate network ko batana ki sale hone par khabar kahan bhejni hai.

**Kya karna hai**

1. Offer sources → naya banaiye, network ka naam daaliye
2. Upar **Postback URL** bana banaya milega:

```
https://track.example.com/postback?clickid={clickid}&payout={payout}&key=xxxx
```

3. Ise **copy karke network ke panel me paste** kar dijiye

**Ye URL karta kya hai**

Ye **andar aane wala** raasta hai. Sale hone par **network aapko call karta hai**, aapka tracker network ko nahi.

Network `{clickid}` ki jagah wahi number bhejta hai jo aapne offer URL me diya tha. Tracker use pehchan kar sale sahi ad ke khaate me daal deta hai.

**key** isliye hai taaki koi ajnabi aapke tracker me jhooti sale na daal sake.

**CLICKID aur SUM:** ye sirf parameter ke **naam** hain. Har network ka apna naam hota hai — kisi ke yahan `sum`, kisi ke `payout`, kisi ke `amount`. Network ke docs me dekh kar wahi naam yahan likh dijiye. Upar ka Postback URL apne aap badal jaayega.

---

## 4. Offer

**Kaam:** wo jagah jahan grahak aakhir me pahunchta hai.

**Kya karna hai**

1. Offers → naya offer
2. **Offer source** chuniye — URL apne aap bhar jaayega (agar us source me template bhara ho)
3. Network ka apna link daaliye:

```
https://network.com/offer/123?aff_sub={clickid}&geo={country}
```

**Sabse zaroori baat**

`{clickid}` **zaroor** hona chahiye.

Yahi wo number hai jo network apne paas rakhta hai aur postback me wapas bhejta hai. Ye chhoot gaya to sab kuch chalta rahega — clicks aayenge, log offer tak pahunchenge — par **sale kabhi nahi dikhegi**.

**Payout type**
- **Auto** — jitna network postback me bhejega, wahi
- **Fixed** — hamesha wahi jo aapne yahan likha

---

## 5. Landing page

**Kaam:** aapka apna page, offer se pehle.

Agar aap seedha offer par bhej rahe ho to ye kadam chhod dijiye.

**Kya karna hai**

1. Landers → naya lander, apne page ka URL daaliye
2. Tracking domain chuniye (kadam 1 wala)
3. Ab page me **do cheezein** lagani hain

**Pehli — page ke HTML me:**

```html
<script src="https://track.example.com/track.js"></script>
```

Ye ginta hai ki banda page tak pahuncha. Na lagaya to **LP Views hamesha 0** rahega.

**Doosri — button par:**

```
https://track.example.com/click
```

"Continue" ya "Buy Now" button ka link isse badal dijiye. Ye do kaam karta hai — ginta hai ki button daba, aur grahak ko offer par bhej deta hai. Na lagaya to **LP Clicks 0** rahenge.

Alag-alag button ya version alag pehchanne ho to `?sub15=version1` jod dijiye.

---

## 6. Campaign

**Kaam:** upar ki sab cheezon ko jodna, aur wo link dena jo ad me jaayega.

**Kya karna hai**

1. Campaigns → **Create new campaign**
2. **Name** — apni pehchan ke liye
3. **Traffic channel** — kadam 2 wala
4. **Domain** — kadam 1 wala (na chuno to default chal jaayega)
5. **Slug** — link me jo dikhega, jaise `my-campaign`
6. **Funnel** me:
   - **LANDING > OFFER** — pehle lander, phir offer
   - **OFFER** — seedha offer par

Save kar dijiye. Ab campaign list me naam ke neeche aapka link dikhega:

```
https://track.example.com/c/my-campaign
```

**Yahi link Facebook/Google ke ad me daalna hai.**

---

## Chalne se pehle jaanch lijiye

Link ko **incognito window** me kholiye (taaki purani cookie asar na kare).

| Kadam | Kya hona chahiye |
|---|---|
| Link khola | Lander khula, URL me `clickid=` dikha |
| Logs → Clicks | Nayi row aayi |
| Button dabaya | Offer khula, uske URL me wahi clickid |
| Landers page | LP Views aur LP Clicks 1 hue |

Ab sale ki jaanch. Ye URL browser me kholiye, `<clickid>` ki jagah upar wala asli number daal kar:

```
https://track.example.com/postback?clickid=<clickid>&payout=10&txid=test-1&key=<aapki-key>
```

Logs → Conversions me nayi row aani chahiye, payout 10 ke saath.

**Ye ho gaya to poora chain sahi hai.**

---

## Kuch galat lage to

| Dikh raha hai | Wajah |
|---|---|
| Clicks aa rahe hain, LP Views 0 | Page me `track.js` nahi laga |
| LP Views hain, LP Clicks 0 | Button par `/click` nahi laga |
| Sab hai, Conversions 0 | Offer URL me `{clickid}` nahi, ya network ko postback URL nahi diya |
| Domain "pending" hi hai | DNS abhi phaila nahi, ya CNAME galat hai |
| Postback par "unknown clickid" | Bheja gaya clickid tracker ke paas hai hi nahi — offer URL me `{clickid}` check kijiye |

---

## Agar Facebook/Google ko sale wapas batani ho

Ye zaroori nahi, par ad platform ise paakar behtar log dhoondhta hai.

1. **CAPI Integrations** → pixel jodiye (Pixel ID + API key, Events Manager se)
2. **View details** → pixel ko **ek traffic channel** ya **ek offer** se jodiye

**Dono jagah mat jodiye** — warna ek hi sale do baar chali jaayegi.

- **Channel par** → sirf us channel ki sales jaayengi
- **Offer par** → us offer ki saari sales jaayengi, chahe kisi bhi channel se aayi ho

Chal raha hai ya nahi, ye **Events sent** column me dikhega. 0 ho to View details kholiye — wahan Facebook ka apna reason likha milega.
