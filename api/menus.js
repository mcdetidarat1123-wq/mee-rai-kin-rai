// POST /api/menus
// body: { ingredients: [{ name, amount }] }
// returns: { menus: [ { id, name, emoji, timeMinutes, calories, difficulty, tags, matchPercent,
//                        macros:{carb,protein,fat}, ingredientsUsed:[{name,amount,have}],
//                        steps:[{title,detail,timerSeconds}] } ] }

const SYSTEM_PROMPT = `คุณคือเชฟผู้ช่วยคิดเมนูอาหารไทย/นานาชาติจากวัตถุดิบที่ผู้ใช้มีอยู่แล้ว
กฎการตอบ:
- คิดเมนูที่ทำได้จริง 4 เมนู โดยใช้วัตถุดิบที่ผู้ใช้มีให้ได้มากที่สุด อนุญาตให้มีวัตถุดิบพื้นฐานเพิ่มเล็กน้อยได้ (เช่น น้ำมัน เกลือ น้ำตาล ซีอิ๊ว) แต่ให้ทำเครื่องหมาย have:false ถ้าไม่ได้อยู่ในลิสต์ที่ผู้ใช้ให้มา
- แต่ละเมนูให้มีความหลากหลาย ไม่ซ้ำสไตล์กันทั้งหมด
- matchPercent = ร้อยละของวัตถุดิบในเมนูที่ผู้ใช้มีอยู่แล้ว (ประมาณจากจำนวนวัตถุดิบ)
- ให้ขั้นตอนทำอาหารละเอียดพอทำตามได้จริง อย่างน้อย 4 ขั้นตอน ขั้นตอนไหนต้องรอ (ต้ม/ทอด/อบ/หมัก) ให้ใส่ timerSeconds เป็นวินาที ขั้นตอนที่ทำทันทีไม่ต้องรอ ให้ timerSeconds เป็น null
- ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นก่อนหรือหลัง ห้ามใช้ markdown code fence
- รูปแบบ JSON ที่ต้องการเป๊ะๆ:
{"menus":[{
  "id":"m1",
  "name":"ชื่อเมนูภาษาไทย",
  "emoji":"อีโมจิ 1 ตัวที่สื่อถึงเมนูนี้",
  "timeMinutes":20,
  "calories":320,
  "difficulty":"ง่าย",
  "tags":["ทำเร็ว","คลีน"],
  "matchPercent":85,
  "macros":{"carb":30,"protein":20,"fat":10},
  "ingredientsUsed":[{"name":"...", "amount":"...", "have":true}],
  "steps":[{"title":"ชื่อขั้นตอนสั้นๆ", "detail":"คำอธิบายละเอียด", "timerSeconds":null}]
}]}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY' });
    return;
  }

  try {
    const { ingredients } = req.body || {};
    if (!Array.isArray(ingredients) || !ingredients.length) {
      res.status(400).json({ error: 'ไม่พบรายการวัตถุดิบ' });
      return;
    }

    const ingredientList = ingredients
      .map((i) => `- ${i.name}${i.amount ? ` (${i.amount})` : ''}`)
      .join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `วัตถุดิบที่มีอยู่:\n${ingredientList}\n\nช่วยคิดเมนู 4 แบบตามกฎที่กำหนด`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status >= 500 ? 502 : 400).json({ error: 'เชื่อมต่อ AI ไม่สำเร็จ ลองอีกครั้งนะ', detail: errText });
      return;
    }

    const data = await response.json();
    const text = (data.content || []).map((b) => b.text || '').join('');
    const cleaned = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: 'แปลผลลัพธ์จาก AI ไม่สำเร็จ ลองอีกครั้งนะ' });
      return;
    }

    if (!Array.isArray(parsed.menus)) parsed.menus = [];
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์', detail: String(err) });
  }
}
