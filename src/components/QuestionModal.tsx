import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CATEGORY_COLORS } from '../lib/boardLayout';

export interface QuestionData {
  id:             string;
  category:       string;
  body:           string;
  correct_answer: string;
  wrong_answers:  string[];
}

interface Props {
  question:  QuestionData;
  onAnswer:  (correct: boolean) => void;
}

export default function QuestionModal({ question, onAnswer }: Props) {
  const choices = useMemo(() => {
    const all = [question.correct_answer, ...question.wrong_answers];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
  }, [question]);

  const [selected, setSelected] = useState<string | null>(null);
  const correct = selected === question.correct_answer;

  function handleSelect(choice: string) {
    if (selected) return;
    setSelected(choice);
    setTimeout(() => onAnswer(choice === question.correct_answer), 1400);
  }

  const catColor = CATEGORY_COLORS[question.category as keyof typeof CATEGORY_COLORS] ?? '#5C3317';

  return (
    <Modal transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={[styles.categoryBadge, { backgroundColor: catColor }]}>
            <Text style={styles.categoryLabel}>{question.category.replace('_', ' & ').toUpperCase()}</Text>
          </View>

          <Text style={styles.body}>{question.body}</Text>

          <View style={styles.choices}>
            {choices.map(choice => {
              let bg = '#fff8e8';
              let border = '#C8930A55';
              if (selected) {
                if (choice === question.correct_answer) { bg = '#d4edda'; border = '#27AE60'; }
                else if (choice === selected)           { bg = '#f8d7da'; border = '#C0392B'; }
              }
              return (
                <TouchableOpacity
                  key={choice}
                  style={[styles.choiceBtn, { backgroundColor: bg, borderColor: border }]}
                  onPress={() => handleSelect(choice)}
                  activeOpacity={selected ? 1 : 0.7}
                >
                  <Text style={styles.choiceText}>{choice}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {selected && (
            <Text style={[styles.verdict, { color: correct ? '#27AE60' : '#C0392B' }]}>
              {correct ? 'Correct!' : `Wrong — ${question.correct_answer}`}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: '#00000088',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#F4E4BC', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, gap: 16, paddingBottom: 40,
  },
  categoryBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20,
  },
  categoryLabel: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  body: { fontSize: 18, fontWeight: '600', color: '#2C1810', lineHeight: 26 },
  choices: { gap: 10 },
  choiceBtn: {
    borderRadius: 12, borderWidth: 1.5, padding: 14,
  },
  choiceText: { fontSize: 15, color: '#2C1810' },
  verdict: { fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
});
