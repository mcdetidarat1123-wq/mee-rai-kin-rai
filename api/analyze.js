// POST /api/analyze
// body: { image: "<base64 no prefix>", mediaType: "image/jpeg" }
// returns: { ingredients: [{ name, amount, confidence }] }

const SYSTEM_PROMPT = `คุณคือผู้ช่วยวิเคราะห์วัตถุดิบอาหารจากรูปถ่ายตู้เย็นหรือวัตถุดิบที่วางอยู่
กฎการตอบ:
- มองหาวัตถุดิบอาหาร (ผัก ผลไม้ เนื้อสัตว์ ไข่ นม เครื่องปรุง ของแห้ง ฯลฯ) ที่เห็นในรูปทั้งหมด
- ประมาณปริมาณคร่าวๆ เป็นหน่วยที่คนไทยเข้าใจง่าย เช่น "2 ฟอง", "1 กำมือ", "ครึ่งถุง", "1 แพ็ก"
- ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นก่อนหรือหลัง ห้ามใช้ markdown code fence
- รูปแบบ JSON ที่ต้องการ:
{"ingredients":[{"name":"ชื่อวัตถุดิบภาษาไทย","amount":"ปริมาณโดยประมาณ","confidence":"high"}]}
- ถ้าในรูปไม่มีวัตถุดิบอาหารเลย ให้ตอบ {"ingredients":[]}`;

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
    const { image, mediaType } = req.body || {};
    if (!image) {
      res.status(400).json({ error: 'ไม่พบรูปภาพที่ส่งมา' });
      return;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image } },
              { type: 'text', text: 'วิเคราะห์วัตถุดิบอาหารทั้งหมดที่เห็นในรูปนี้' },
            ],
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

    if (!Array.isArray(parsed.ingredients)) parsed.ingredients = [];
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์', detail: String(err) });
  }
}
