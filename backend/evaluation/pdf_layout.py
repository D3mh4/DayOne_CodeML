"""
Lecture géométrique d'une page du PDF synthétique des organisateurs, pour en tirer la vérité terrain.

Le PDF contient : le formulaire imprimé (police Helvetica), les valeurs « manuscrites » (une police manuscrite
différente par patiente : Caveat, Gaegu...), les cases à cocher (petits carrés) et les coches à l'encre
(traits d'une autre couleur que le formulaire). Certaines pages sont légèrement inclinées : on les redresse.
"""
import math
import re
import statistics
import unicodedata
from dataclasses import dataclass
from typing import Optional

import pdfplumber

form_color = (0.12, 0.08, 0.1)  # couleur des traits imprimés du formulaire
dot_leader_pattern = re.compile(r'^[.…_]+$')
dash_values = {'-', '–', '—', '−'}


def normalize_text(raw_text: str) -> str:
    """Minuscules, sans accents ni ponctuation ni espaces : sert à comparer des libellés."""
    text_val = raw_text.replace('œ', 'oe').replace('Œ', 'OE')
    text_val = unicodedata.normalize('NFKD', text_val)
    text_val = ''.join(char for char in text_val if not unicodedata.combining(char))
    # Le « + » est gardé : sinon « Rh+ » et « Rh- » deviendraient identiques
    return re.sub(r'[^a-z0-9+]', '', text_val.lower())


def _is_form_font(font_name: str) -> bool:
    return 'Helvetica' in font_name


def _color_tuple(raw_color) -> Optional[tuple]:
    if isinstance(raw_color, (tuple, list)) and len(raw_color) == 3:
        return tuple(round(float(c), 2) for c in raw_color)
    return None


@dataclass
class layout_word:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float
    size: float
    is_ink: bool  # True = écriture (valeur), False = formulaire imprimé
    is_bold: bool

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2


@dataclass
class layout_box:
    x0: float
    x1: float
    top: float
    bottom: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2


class page_layout:
    def __init__(self, pdf_page: pdfplumber.page.Page):
        self.width = float(pdf_page.width)
        self.height = float(pdf_page.height)

        form_chars = [c for c in pdf_page.chars if _is_form_font(c['fontname'])]
        median_angle = statistics.median(
            math.atan2(c['matrix'][1], c['matrix'][0]) for c in form_chars
        ) if form_chars else 0.0
        self.angle_deg = math.degrees(median_angle)
        self._rotation = self._pick_rotation(form_chars, median_angle)

        self.words = self._build_words(pdf_page.chars)
        self.form_words = [w for w in self.words if not w.is_ink]
        self.ink_words = [w for w in self.words if w.is_ink]
        self.check_boxes, self.ink_marks = self._build_shapes(pdf_page)

    # -- redressement ---------------------------------------------------------------------------

    def _rotate(self, x: float, y: float, angle: float) -> tuple[float, float]:
        center_x, center_y = self.width / 2, self.height / 2
        dx, dy = x - center_x, y - center_y
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        return center_x + dx * cos_a - dy * sin_a, center_y + dx * sin_a + dy * cos_a

    def _pick_rotation(self, form_chars: list[dict], median_angle: float) -> float:
        """Le sens de rotation dépend du repère (y vers le bas) : on garde celui qui aligne le mieux le titre."""
        if abs(median_angle) < 1e-4 or not form_chars:
            return 0.0
        largest_size = max(c['size'] for c in form_chars)
        title_chars = [c for c in form_chars if c['size'] >= largest_size - 0.5]

        def spread(angle: float) -> float:
            ys = [self._rotate((c['x0'] + c['x1']) / 2, (c['top'] + c['bottom']) / 2, angle)[1] for c in title_chars]
            return max(ys) - min(ys)

        return min((median_angle, -median_angle), key=spread)

    def _straight(self, x: float, y: float) -> tuple[float, float]:
        return self._rotate(x, y, self._rotation) if self._rotation else (x, y)

    # -- mots ------------------------------------------------------------------------------------

    def _build_words(self, raw_chars: list[dict]) -> list[layout_word]:
        chars = []
        for c in raw_chars:
            # Les espaces sont gardés : ils séparent les mots (l'écriture a des espacements irréguliers)
            cx, cy = self._straight((c['x0'] + c['x1']) / 2, (c['top'] + c['bottom']) / 2)
            half_w, half_h = (c['x1'] - c['x0']) / 2, (c['bottom'] - c['top']) / 2
            chars.append({
                'text': c['text'], 'x0': cx - half_w, 'x1': cx + half_w, 'top': cy - half_h, 'bottom': cy + half_h,
                'cy': cy, 'size': c['size'], 'is_ink': not _is_form_font(c['fontname']),
                'is_bold': 'Bold' in c['fontname'], 'is_space': not c['text'].strip(),
            })

        words: list[layout_word] = []
        for is_ink in (False, True):
            group = sorted((c for c in chars if c['is_ink'] == is_ink), key=lambda c: c['cy'])
            # Regroupement en lignes (l'écriture « manuscrite » sautille un peu : tolérance plus large)
            lines: list[list[dict]] = []
            for c in group:
                tolerance = c['size'] * (0.55 if is_ink else 0.4)
                if lines and abs(c['cy'] - statistics.mean(x['cy'] for x in lines[-1])) < tolerance:
                    lines[-1].append(c)
                else:
                    lines.append([c])
            for line_chars in lines:
                line_chars.sort(key=lambda c: c['x0'])
                current: list[dict] = []
                for c in line_chars:
                    if c['is_space']:
                        if current:
                            words.append(self._make_word(current))
                        current = []
                        continue
                    if current and c['x0'] - current[-1]['x1'] > c['size'] * 0.3:
                        words.append(self._make_word(current))
                        current = []
                    current.append(c)
                if current:
                    words.append(self._make_word(current))
        return sorted(words, key=lambda w: (round(w.cy), w.x0))

    @staticmethod
    def _make_word(chars: list[dict]) -> layout_word:
        return layout_word(
            text=''.join(c['text'] for c in chars),
            x0=min(c['x0'] for c in chars), x1=max(c['x1'] for c in chars),
            top=min(c['top'] for c in chars), bottom=max(c['bottom'] for c in chars),
            size=statistics.median(c['size'] for c in chars),
            is_ink=chars[0]['is_ink'], is_bold=chars[0]['is_bold'],
        )

    # -- cases et coches -------------------------------------------------------------------------

    def _build_shapes(self, pdf_page) -> tuple[list[layout_box], list[tuple[float, float]]]:
        boxes: list[layout_box] = []
        marks: list[tuple[float, float]] = []
        for shape in list(pdf_page.curves) + list(pdf_page.rects) + list(pdf_page.lines):
            width, height = shape['x1'] - shape['x0'], shape['bottom'] - shape['top']
            color = _color_tuple(shape.get('stroking_color'))
            cx, cy = self._straight((shape['x0'] + shape['x1']) / 2, (shape['top'] + shape['bottom']) / 2)
            if color == form_color:
                if 5 <= width <= 15 and 5 <= height <= 15 and abs(width - height) < 3:
                    boxes.append(layout_box(cx - width / 2, cx + width / 2, cy - height / 2, cy + height / 2))
            elif color is not None and width < 30 and height < 30:
                marks.append((cx, cy))
        return boxes, marks

    def is_box_checked(self, box: layout_box) -> bool:
        return any(
            box.x0 - 3 <= mark_x <= box.x1 + 3 and box.top - 3 <= mark_y <= box.bottom + 3
            for mark_x, mark_y in self.ink_marks
        )

    # -- recherche de libellés -------------------------------------------------------------------

    def contains_line_text(self, label: str) -> bool:
        """Le libellé apparaît-il dans une ligne imprimée (même collé à un autre mot) ?"""
        target = normalize_text(label)
        return any(target in ''.join(normalize_text(w.text) for w in line) for line in self._group_lines(self.form_words))

    def find_label(self, label: str, words: Optional[list[layout_word]] = None, skip_bold: bool = False) -> list[layout_box]:
        """Toutes les occurrences d'un libellé imprimé (suite de mots consécutifs sur une ligne), dans l'ordre de lecture."""
        target = normalize_text(label)
        candidates = [w for w in (words or self.form_words) if not (skip_bold and w.is_bold)]
        lines = self._group_lines(candidates)
        found: list[layout_box] = []
        for line_words in lines:
            for start in range(len(line_words)):
                if not normalize_text(line_words[start].text):
                    continue  # une correspondance ne commence jamais par de la ponctuation (« : »)
                joined = ''
                for end in range(start, len(line_words)):
                    joined += normalize_text(line_words[end].text)
                    if joined == target:
                        span = line_words[start:end + 1]
                        found.append(layout_box(span[0].x0, span[-1].x1, min(w.top for w in span), max(w.bottom for w in span)))
                        break
                    if not target.startswith(joined):
                        break
        return sorted(found, key=lambda b: (round(b.cy), b.x0))

    @staticmethod
    def _group_lines(words: list[layout_word]) -> list[list[layout_word]]:
        lines: list[list[layout_word]] = []
        for w in sorted(words, key=lambda w: w.cy):
            if lines and abs(w.cy - statistics.mean(x.cy for x in lines[-1])) < w.size * 0.45:
                lines[-1].append(w)
            else:
                lines.append([w])
        return [sorted(line, key=lambda w: w.x0) for line in lines]

    def next_form_word_right(self, anchor: layout_box) -> Optional[layout_word]:
        """Prochain mot imprimé à droite de l'ancre sur la même ligne (les pointillés ne comptent pas)."""
        same_line = [
            w for w in self.form_words
            if abs(w.cy - anchor.cy) < 5 and w.x0 > anchor.x1 + 1
            and not dot_leader_pattern.match(w.text) and normalize_text(w.text)
        ]
        return min(same_line, key=lambda w: w.x0) if same_line else None

    def ink_text_in(self, x0: float, x1: float, top: float, bottom: float) -> str:
        inside = [w for w in self.ink_words if x0 <= w.cx <= x1 and top <= w.cy <= bottom]
        return ' '.join(w.text for w in self._reading_order(inside))

    def _reading_order(self, words: list[layout_word]) -> list[layout_word]:
        return [w for line in self._group_lines(words) for w in line]

    def box_next_to(self, label_box: layout_box, max_distance: float = 80) -> Optional[layout_box]:
        """Case à cocher la plus proche d'un libellé d'option, sur la même ligne (à gauche ou à droite)."""
        best_box, best_distance = None, max_distance
        for box in self.check_boxes:
            if abs(box.cy - label_box.cy) > 7:
                continue
            distance = label_box.x0 - box.x1 if box.cx < label_box.cx else box.x0 - label_box.x1
            if -2 <= distance < best_distance:
                best_box, best_distance = box, distance
        return best_box
